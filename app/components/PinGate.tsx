'use client'
// ============================================================
// PinGate — 관리자 PIN 인증 화면
// 세션 중 한 번만 입력하면 됨 (sessionStorage 저장)
// 5회 연속 오입력 시 30초 잠금
// ============================================================
import { useState, useEffect, useCallback } from 'react'

interface Props {
  onSuccess: () => void
}

const MAX_ATTEMPTS  = 5      // 최대 실패 횟수
const LOCKOUT_SECS  = 30     // 잠금 시간 (초)
const STORAGE_KEY   = 'pin_gate'   // sessionStorage 키

interface GateState {
  attempts:   number
  lockedUntil: number   // Unix timestamp (ms), 0 = 잠금 없음
}

function loadState(): GateState {
  if (typeof window === 'undefined') return { attempts: 0, lockedUntil: 0 }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { attempts: 0, lockedUntil: 0 }
    return JSON.parse(raw) as GateState
  } catch {
    return { attempts: 0, lockedUntil: 0 }
  }
}

function saveState(s: GateState) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

export default function PinGate({ onSuccess }: Props) {
  const [pin,       setPin]       = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [remaining, setRemaining] = useState(0)   // 잠금 남은 초

  // 잠금 카운트다운 타이머
  useEffect(() => {
    const tick = () => {
      const { lockedUntil } = loadState()
      if (lockedUntil <= Date.now()) {
        setRemaining(0)
        return
      }
      setRemaining(Math.ceil((lockedUntil - Date.now()) / 1000))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [])

  // 이미 이번 세션에 인증했다면 바로 통과
  useEffect(() => {
    if (sessionStorage.getItem('admin_verified') === 'true') {
      onSuccess()
    }
  }, [onSuccess])

  const isLocked = remaining > 0

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin || isLocked) return

    const state = loadState()

    // 잠금 재확인
    if (state.lockedUntil > Date.now()) {
      setRemaining(Math.ceil((state.lockedUntil - Date.now()) / 1000))
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin-pin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin }),
      })

      if (res.ok) {
        // 성공 → 상태 초기화
        saveState({ attempts: 0, lockedUntil: 0 })
        sessionStorage.setItem('admin_verified', 'true')
        onSuccess()
      } else {
        const data = await res.json()
        const newAttempts = state.attempts + 1

        if (newAttempts >= MAX_ATTEMPTS) {
          // 잠금 처리
          const lockedUntil = Date.now() + LOCKOUT_SECS * 1000
          saveState({ attempts: newAttempts, lockedUntil })
          setRemaining(LOCKOUT_SECS)
          setError(`핀 번호 ${MAX_ATTEMPTS}회 오입력 — ${LOCKOUT_SECS}초 후 다시 시도하세요.`)
        } else {
          saveState({ attempts: newAttempts, lockedUntil: 0 })
          const left = MAX_ATTEMPTS - newAttempts
          setError(`${data.error ?? '핀 번호가 틀렸습니다.'} (남은 시도: ${left}회)`)
        }
        setPin('')
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    }

    setLoading(false)
  }, [pin, isLocked, onSuccess])

  return (
    <div className="min-h-screen bg-gray-50
                    flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg
                        bg-gray-900 mb-4">
          <span className="text-sm font-bold tracking-tight text-white">DABs</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">관리자 인증</h1>
        <p className="text-gray-500 text-sm mt-1">관리자 PIN 번호를 입력하세요</p>
      </div>

      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium">PIN 번호</label>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="••••"
              maxLength={20}
              disabled={isLocked}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center
                         text-xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-gray-900
                         focus:border-gray-900 placeholder:text-gray-300 transition-colors
                         disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>

          {/* 잠금 카운트다운 */}
          {isLocked && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-center">
              <p className="text-sm font-semibold text-red-700">입력이 일시적으로 제한되었습니다</p>
              <p className="text-xs text-red-500 mt-1">
                <span className="font-mono text-base font-bold">{remaining}</span>초 후 다시 시도하세요
              </p>
            </div>
          )}

          {/* 일반 에러 */}
          {error && !isLocked && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-2.5 text-sm text-red-600 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !pin || isLocked}
            className="w-full py-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-white
                       font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                확인 중...
              </span>
            ) : isLocked ? `${remaining}초 후 재시도` : '관리자 대시보드 입장'}
          </button>
        </form>
      </div>
    </div>
  )
}
