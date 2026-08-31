// ============================================================
// app/page.tsx  —  루트 랜딩 페이지
// 로그인 + 역할에 따른 라우팅 (관리자 / 업체 담당자)
// ============================================================
'use client'

import { useState, useEffect, useMemo, FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type AuthMode = 'login' | 'signup'
type PageState = 'checking' | 'unauthenticated' | 'loggedIn'

// ── 메인 ────────────────────────────────────────────────────
export default function RootPage() {
  const supabase = useMemo(() => createClient(), [])
  const [state,     setState]     = useState<PageState>('checking')
  const [userEmail, setUserEmail] = useState('')

  // ── 세션 확인 ──────────────────────────────────────────────
  useEffect(() => {
    async function checkSession() {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        )
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          timeout
        ])
        if (!session) { setState('unauthenticated'); return }
        setUserEmail(session.user.email ?? '')
        setState('loggedIn')
      } catch {
        setState('unauthenticated')
      }
    }

    // 로그인/로그아웃 상태 변화 구독
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          setUserEmail(session.user.email ?? '')
          setState('loggedIn')
        } else {
          setState('unauthenticated')
        }
      }
    )

    checkSession()
    return () => subscription.unsubscribe()
  }, [supabase])

  if (state === 'checking') return <SplashScreen />
  if (state === 'loggedIn') return <LoggedInPanel email={userEmail} supabase={supabase} />
  return <LoginPanel />
}

// ── 로그인 완료 패널 (협력업체 / 관리자 공통) ─────────────────
function LoggedInPanel({ email, supabase }: { email: string; supabase: ReturnType<typeof createClient> }) {
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleSignOut() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    // onAuthStateChange가 state를 'unauthenticated'로 바꿔줌
  }

  return (
    <AuthShell>
      <div className="space-y-5">
        {/* 로그인 상태 표시 */}
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3.5">
          <span className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 text-sm font-bold shrink-0">
            ✓
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800">로그인됨</p>
            <p className="text-xs text-emerald-600 truncate">{email}</p>
          </div>
        </div>

        {/* 협력업체 안내 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-center">
          <p className="text-2xl mb-2">🏗️</p>
          <p className="text-sm font-semibold text-slate-700 mb-1">협력업체 담당자</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            관리자에게 받은 링크로 접속하세요.<br />
            <span className="font-mono text-slate-400">/submit/[팀코드]</span>
          </p>
        </div>

        {/* 관리자 대시보드 버튼 */}
        <a
          href="/dashboard"
          className="flex items-center justify-between w-full px-5 py-3.5
                     bg-slate-800 hover:bg-slate-700 text-white rounded-xl
                     transition-all hover:-translate-y-0.5 group"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🔒</span>
            <div>
              <p className="text-sm font-semibold leading-tight">관리자 대시보드</p>
              <p className="text-xs text-slate-400">PIN 번호 입력 후 입장</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>

        {/* 로그아웃 */}
        <button
          onClick={handleSignOut}
          disabled={loggingOut}
          className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-500
                     hover:text-red-500 hover:border-red-200 text-sm transition-colors disabled:opacity-50"
        >
          {loggingOut ? '로그아웃 중...' : '로그아웃'}
        </button>
      </div>
    </AuthShell>
  )
}

// ── 로그인 패널 ──────────────────────────────────────────────
function LoginPanel() {
  const supabase = useMemo(() => createClient(), [])
  const [mode,     setMode]     = useState<AuthMode>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [sent,     setSent]     = useState(false)  // 매직링크 전송 여부

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    if (mode === 'signup') setSent(true)
    setLoading(false)
  }

  async function handleMagicLink() {
    if (!email) { setError('이메일을 먼저 입력해 주세요.'); return }
    setLoading(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (authError) { setError(authError.message); setLoading(false); return }
    setSent(true)
    setLoading(false)
  }

  // 매직링크 전송 완료 화면
  if (sent) {
    return (
      <AuthShell>
        <div className="text-center space-y-3 py-4">
          <div className="text-5xl">📬</div>
          <h2 className="text-xl font-bold text-slate-800">이메일을 확인하세요</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            <span className="font-medium text-slate-700">{email}</span>로<br />
            {mode === 'signup' ? '가입 확인 링크를' : '로그인 링크를'} 보냈습니다.
          </p>
          <button
            onClick={() => setSent(false)}
            className="text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            다른 방법으로 로그인
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      {/* 탭: 로그인 / 회원가입 */}
      <div className="flex rounded-xl overflow-hidden border border-slate-200 mb-6">
        {(['login', 'signup'] as AuthMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError('') }}
            className={[
              'flex-1 py-2.5 text-sm font-semibold transition-colors',
              mode === m
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-500 hover:bg-slate-50',
            ].join(' ')}
          >
            {m === 'login' ? '로그인' : '계정 만들기'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 이메일 */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">이메일</label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm
                       outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                       placeholder:text-slate-300 transition-colors"
          />
        </div>

        {/* 비밀번호 */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">비밀번호</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="6자 이상"
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm
                       outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                       placeholder:text-slate-300 transition-colors"
          />
        </div>

        {/* 에러 메시지 */}
        {error && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <span>⚠️</span> {error}
          </p>
        )}

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                     font-semibold text-sm transition-colors disabled:opacity-50"
        >
          {loading ? '처리 중...' : mode === 'login' ? '로그인' : '계정 만들기'}
        </button>
      </form>

      {/* 구분선 */}
      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-white text-xs text-slate-400">또는</span>
        </div>
      </div>

      {/* 매직링크 로그인 */}
      <button
        type="button"
        onClick={handleMagicLink}
        disabled={loading}
        className="w-full py-3 rounded-xl border border-slate-300 hover:border-blue-400
                   text-slate-600 hover:text-blue-600 font-medium text-sm
                   transition-colors flex items-center justify-center gap-2"
      >
        <span>✉️</span> 이메일 링크로 로그인
      </button>
    </AuthShell>
  )
}

// ── 공통 레이아웃 래퍼 ───────────────────────────────────────
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50
                     flex flex-col items-center justify-center px-4">
      {/* 로고/타이틀 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                        bg-blue-600 shadow-lg shadow-blue-200 mb-4">
          <span className="text-2xl">📋</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">DABs 자료 취합</h1>
        <p className="text-slate-500 text-sm mt-1">회의 자료 제출 및 관리 시스템</p>
      </div>

      {/* 카드 */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg shadow-slate-200 p-8">
        {children}
      </div>
    </main>
  )
}

// ── 스플래시 (세션 확인 중) ──────────────────────────────────
function SplashScreen() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600">
          <span className="text-2xl">📋</span>
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          DABs 자료 취합 시스템
        </div>
      </div>
    </main>
  )
}

// ============================================================
// app/(auth)/callback/route.ts  —  Auth 콜백 핸들러
// ============================================================
//
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
// import { cookies } from 'next/headers'
// import { NextResponse } from 'next/server'
// import type { NextRequest } from 'next/server'
//
// export async function GET(req: NextRequest) {
//   const { searchParams, origin } = new URL(req.url)
//   const code = searchParams.get('code')
//   if (code) {
//     const supabase = createRouteHandlerClient({ cookies })
//     await supabase.auth.exchangeCodeForSession(code)
//   }
//   return NextResponse.redirect(origin)
// }
