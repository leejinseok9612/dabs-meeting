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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50
                    flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                        bg-blue-600 shadow-lg shadow-blue-200 mb-4">
          <span className="text-2xl">🔒</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">관리자 인증</h1>
        <p className="text-slate-500 text-sm mt-1">관리자 PIN 번호를 입력하세요</p>
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg shadow-slate-200 p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">PIN 번호</label>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="••••"
              maxLength={20}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-center
                         text-xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-blue-500 placeholder:text-slate-200 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600 text-center">
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !pin}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                       font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {loading ? '확인 중...' : '관리자 대시보드 입장'}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-4">
          기본 PIN: 1234 (Supabase → site_settings에서 변경 가능)
        </p>
      </div>
    </div>
  )
}
