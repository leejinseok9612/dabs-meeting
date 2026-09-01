'use client'
// ============================================================
// PinGate — 관리자 PIN 인증 화면
// 세션 중 한 번만 입력하면 됨 (sessionStorage 저장)
// ============================================================
import { useState, useEffect } from 'react'

interface Props {
  onSuccess: () => void
}

export default function PinGate({ onSuccess }: Props) {
  const [pin,     setPin]     = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // 이미 이번 세션에 인증했다면 바로 통과
  useEffect(() => {
    if (sessionStorage.getItem('admin_verified') === 'true') {
      onSuccess()
    }
  }, [onSuccess])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pin) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin-pin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin }),
      })
      if (res.ok) {
        sessionStorage.setItem('admin_verified', 'true')
        onSuccess()
      } else {
        const data = await res.json()
        setError(data.error ?? '핀 번호가 틀렸습니다.')
        setPin('')
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    }
    setLoading(false)
  }

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
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center
                         text-xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-gray-900
                         focus:border-gray-900 placeholder:text-gray-300 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-2.5 text-sm text-red-600 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !pin}
            className="w-full py-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-white
                       font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {loading ? '확인 중...' : '관리자 대시보드 입장'}
          </button>
        </form>

        <p className="text-xs text-gray-500 text-center mt-4">
          기본 PIN: 1234 (Supabase → site_settings에서 변경 가능)
        </p>
      </div>
    </div>
  )
}
