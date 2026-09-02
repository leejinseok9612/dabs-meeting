// ============================================================
// app/page.tsx  —  루트 랜딩 페이지
// 로그인 + 역할에 따른 라우팅 (관리자 / 업체 담당자)
// ============================================================
'use client'

import { useState, useEffect, useMemo, FormEvent, useCallback } from 'react'
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

// ── 로그인 완료 패널 ─────────────────────────────────────────
function LoggedInPanel({ email, supabase }: { email: string; supabase: ReturnType<typeof createClient> }) {
  const router = useRouter()

  const [teamLoading, setTeamLoading] = useState(true)
  const [myTeam,      setMyTeam]      = useState<{ id: string; name: string } | null>(null)
  const [allTeams,    setAllTeams]    = useState<{ id: string; name: string }[]>([])
  const [selectedId,  setSelectedId]  = useState('')
  const [claiming,    setClaiming]    = useState(false)
  const [claimError,  setClaimError]  = useState('')
  const [loggingOut,  setLoggingOut]  = useState(false)
  // 업체 배정은 있지만 "다른 업체 선택" 모드
  const [reassigning, setReassigning] = useState(false)

  // 내 업체 & 전체 업체 목록 로드 (자동 리다이렉트 없이 선택 화면 표시)
  const loadTeam = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setTeamLoading(false); return }

    const { data: assigned } = await supabase
      .from('team_assignments')
      .select('team_id, teams(id, name)')
      .eq('user_id', user.id)
      .maybeSingle()

    if (assigned?.teams) {
      setMyTeam(assigned.teams as unknown as { id: string; name: string })
    }

    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .order('name')
    setAllTeams(teams ?? [])
    setTeamLoading(false)
  }, [supabase])

  useEffect(() => { loadTeam() }, [loadTeam])

  // 업체 등록 또는 재배정
  async function handleClaim() {
    if (!selectedId) return
    setClaiming(true)
    setClaimError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setClaimError('로그인 정보를 찾을 수 없습니다.'); setClaiming(false); return }

    if (reassigning) {
      // 기존 배정 삭제 후 새로 등록
      await supabase.from('team_assignments').delete().eq('user_id', user.id)
    }

    const { error } = await supabase
      .from('team_assignments')
      .insert({ user_id: user.id, team_id: selectedId })

    if (error) {
      setClaimError(error.code === '23505'
        ? '이미 다른 사람이 등록한 업체입니다.'
        : error.message)
      setClaiming(false)
      return
    }

    router.replace(`/submit/${selectedId}`)
  }

  async function handleSignOut() {
    setLoggingOut(true)
    sessionStorage.removeItem('admin_verified')
    await supabase.auth.signOut()
  }

  if (teamLoading) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center py-8 gap-3">
          <div className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">불러오는 중...</p>
        </div>
      </AuthShell>
    )
  }

  // ── 업체 배정돼 있고 재선택 모드가 아니면 → 입장 선택 화면 ──
  if (myTeam && !reassigning) {
    return (
      <AuthShell>
        <div className="space-y-4">
          {/* 로그인 상태 */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <p className="text-xs text-gray-600 truncate">{email}</p>
          </div>

          <p className="text-sm font-semibold text-gray-900">어떻게 입장하시겠습니까?</p>

          {/* 업체 페이지 */}
          <button
            onClick={() => router.replace(`/submit/${myTeam.id}`)}
            className="w-full flex items-center justify-between px-4 py-4
                       bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-colors"
          >
            <div className="text-left">
              <p className="text-sm font-semibold">{myTeam.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">자료 제출 페이지</p>
            </div>
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* 관리자 대시보드 */}
          <a
            href="/dashboard"
            className="flex items-center justify-between w-full px-4 py-4
                       bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl
                       transition-colors"
          >
            <div className="text-left">
              <p className="text-sm font-semibold">관리자 대시보드</p>
              <p className="text-xs text-gray-400 mt-0.5">PIN 인증 후 입장</p>
            </div>
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>

          <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
            <button
              onClick={() => { setReassigning(true); setSelectedId('') }}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              다른 업체로 전환
            </button>
            <button
              onClick={handleSignOut}
              disabled={loggingOut}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              {loggingOut ? '로그아웃 중...' : '로그아웃'}
            </button>
          </div>
        </div>
      </AuthShell>
    )
  }

  // ── 업체 선택 / 재선택 UI ──
  return (
    <AuthShell>
      <div className="space-y-5">

        {/* 로그인 상태 */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <p className="text-xs text-gray-600 truncate">{email}</p>
        </div>

        {/* 업체 선택 */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold tracking-tight text-gray-900 mb-0.5">
              {reassigning ? '전환할 업체를 선택하세요' : '소속 업체를 선택하세요'}
            </p>
            <p className="text-xs text-gray-500">선택 후 해당 제출 페이지로 이동합니다</p>
          </div>

          <div className="space-y-2">
            {allTeams.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={[
                  'w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all',
                  selectedId === t.id
                    ? 'border-gray-900 bg-white'
                    : 'border-gray-200 hover:border-gray-300 bg-white',
                ].join(' ')}
              >
                <span className={[
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                  selectedId === t.id ? 'border-gray-900 bg-gray-900' : 'border-gray-300',
                ].join(' ')}>
                  {selectedId === t.id && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <span className={`text-sm font-medium ${selectedId === t.id ? 'text-gray-900' : 'text-gray-700'}`}>
                  {t.name}
                </span>
              </button>
            ))}

            {allTeams.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                등록 가능한 업체가 없습니다.<br />관리자에게 문의하세요.
              </p>
            )}
          </div>

          {claimError && (
            <p className="text-xs text-red-600">{claimError}</p>
          )}

          <button
            onClick={handleClaim}
            disabled={!selectedId || claiming}
            className="w-full py-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-white
                       font-semibold text-sm transition-colors disabled:opacity-40"
          >
            {claiming ? '처리 중...' : '입장하기'}
          </button>
        </div>

        {/* 관리자 대시보드 + 로그아웃 */}
        <div className="border-t border-gray-200 pt-4 space-y-2">
          <a
            href="/dashboard"
            className="flex items-center justify-between w-full px-4 py-3
                       bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg
                       transition-all group text-sm"
          >
            <span className="font-semibold">관리자 대시보드</span>
            <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>

          <div className="flex items-center justify-between pt-1">
            {reassigning && (
              <button
                onClick={() => setReassigning(false)}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                ← 돌아가기
              </button>
            )}
            <button
              onClick={handleSignOut}
              disabled={loggingOut}
              className="ml-auto text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              {loggingOut ? '로그아웃 중...' : '로그아웃'}
            </button>
          </div>
        </div>
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
          <div className="text-4xl">✓</div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">이메일을 확인하세요</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            <span className="font-medium text-gray-600">{email}</span>로<br />
            {mode === 'signup' ? '가입 확인 링크를' : '로그인 링크를'} 보냈습니다.
          </p>
          <button
            onClick={() => setSent(false)}
            className="text-xs text-gray-600 underline underline-offset-2 hover:text-gray-900"
          >
            다른 방법으로 로그인
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      {/* 탭: 로그인 / 회원가입 (언더라인 스타일) */}
      <div className="flex gap-8 border-b border-gray-200 mb-6">
        {(['login', 'signup'] as AuthMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError('') }}
            className={[
              'text-sm font-semibold pb-3 transition-colors relative',
              mode === m
                ? 'text-gray-900'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {m === 'login' ? '로그인' : '계정 만들기'}
            {mode === m && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900" />
            )}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 이메일 */}
        <div className="space-y-1.5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium">이메일</label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm
                       outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900
                       placeholder:text-gray-400 transition-colors"
          />
        </div>

        {/* 비밀번호 */}
        <div className="space-y-1.5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium">비밀번호</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="6자 이상"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm
                       outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900
                       placeholder:text-gray-400 transition-colors"
          />
        </div>

        {/* 에러 메시지 */}
        {error && (
          <p className="text-xs text-red-600">
            {error}
          </p>
        )}

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-white
                     font-semibold text-sm transition-colors disabled:opacity-50"
        >
          {loading ? '처리 중...' : mode === 'login' ? '로그인' : '계정 만들기'}
        </button>
      </form>

      {/* 구분선 */}
      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-white text-xs text-gray-400">또는</span>
        </div>
      </div>

      {/* 매직링크 로그인 */}
      <button
        type="button"
        onClick={handleMagicLink}
        disabled={loading}
        className="w-full py-3 rounded-lg border border-gray-200 hover:bg-gray-50
                   text-gray-600 font-medium text-sm
                   transition-colors"
      >
        이메일 링크로 로그인
      </button>
    </AuthShell>
  )
}

// ── 공통 레이아웃 래퍼 ───────────────────────────────────────
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50
                     flex flex-col items-center justify-center px-4">
      {/* 로고/타이틀 */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg
                        bg-gray-900 mb-4">
          <span className="text-sm font-bold tracking-tight text-white">DABs</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">회의 자료 취합</h1>
        <p className="text-gray-500 text-sm mt-1">DABs 제출 및 관리 시스템</p>
      </div>

      {/* 카드 */}
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        {children}
      </div>
    </main>
  )
}

// ── 스플래시 (세션 확인 중) ──────────────────────────────────
function SplashScreen() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-500">로딩 중...</span>
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
