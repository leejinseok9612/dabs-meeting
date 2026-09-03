// ============================================================
// app/page.tsx  —  단일 페이지 앱 루트 (URL은 항상 /)
// 뷰 상태: login → select → submit | admin-list → admin-detail
// ============================================================
'use client'

import { useState, useEffect, useMemo, FormEvent, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SubmitView }      from '@/app/components/views/SubmitView'
import { AdminListView }   from '@/app/components/views/AdminListView'
import { AdminDetailView } from '@/app/components/views/AdminDetailView'

// ── 뷰 타입 ─────────────────────────────────────────────────
type View =
  | { name: 'login' }
  | { name: 'select'; email: string }
  | { name: 'submit'; teamId: string }
  | { name: 'admin-list' }
  | { name: 'admin-detail'; meetingId: string }

type AuthMode = 'login' | 'signup'

// ── 뷰 상태 localStorage 저장/복원 ───────────────────────────
const DABS_VIEW_KEY = 'dabs_view'

function saveView(v: View) {
  try {
    // login / select는 저장 안 함 (인증 후 항상 재확인)
    if (v.name === 'submit' || v.name === 'admin-list' || v.name === 'admin-detail') {
      localStorage.setItem(DABS_VIEW_KEY, JSON.stringify(v))
    } else {
      localStorage.removeItem(DABS_VIEW_KEY)
    }
  } catch {}
}

function loadSavedView(): View | null {
  try {
    const raw = localStorage.getItem(DABS_VIEW_KEY)
    if (raw) return JSON.parse(raw) as View
  } catch {}
  return null
}

// ── 메인 라우터 ──────────────────────────────────────────────
export default function RootPage() {
  const supabase = useMemo(() => createClient(), [])
  const [view, setView] = useState<View>({ name: 'login' })
  const [userEmail, setUserEmail] = useState('')
  const [checking, setChecking] = useState(true)

  // setView + localStorage 동기화
  const navigate = useCallback((v: View) => {
    setView(v)
    saveView(v)
  }, [])

  useEffect(() => {
    let resolved = false
    const fallback = setTimeout(() => {
      if (!resolved) { setChecking(false) }
    }, 3000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!resolved || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          resolved = true
          clearTimeout(fallback)
          if (session) {
            const email = session.user.email ?? ''
            setUserEmail(email)
            // 저장된 뷰 복원 (있으면 바로 복원, 없으면 선택 화면)
            const saved = loadSavedView()
            setView(saved ?? { name: 'select', email })
          } else {
            // 로그아웃 → 저장된 뷰 삭제
            localStorage.removeItem(DABS_VIEW_KEY)
            setView({ name: 'login' })
          }
          setChecking(false)
        }
      }
    )
    return () => { clearTimeout(fallback); subscription.unsubscribe() }
  }, [supabase])

  if (checking) return <SplashScreen />

  if (view.name === 'login')
    return <LoginPanel onLoggedIn={(email) => navigate({ name: 'select', email })} />

  if (view.name === 'select')
    return (
      <SelectPanel
        email={view.email}
        onSubmit={(teamId) => navigate({ name: 'submit', teamId })}
        onAdmin={() => navigate({ name: 'admin-list' })}
        onSignOut={() => navigate({ name: 'login' })}
      />
    )

  if (view.name === 'submit')
    return (
      <SubmitView
        teamId={view.teamId}
        onBack={() => navigate({ name: 'select', email: userEmail })}
      />
    )

  if (view.name === 'admin-list')
    return (
      <AdminListView
        onEnterMeeting={(meetingId) => navigate({ name: 'admin-detail', meetingId })}
        onBack={() => navigate({ name: 'login' })}
      />
    )

  if (view.name === 'admin-detail')
    return (
      <AdminDetailView
        meetingId={view.meetingId}
        onBack={() => navigate({ name: 'admin-list' })}
      />
    )

  return null
}

// ── 업체 선택 / 역할 선택 패널 ───────────────────────────────
function SelectPanel({
  email, onSubmit, onAdmin, onSignOut,
}: {
  email: string
  onSubmit: (teamId: string) => void
  onAdmin: () => void
  onSignOut: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [teamLoading, setTeamLoading] = useState(true)
  const [myTeam,      setMyTeam]      = useState<{ id: string; name: string } | null>(null)
  const [allTeams,    setAllTeams]    = useState<{ id: string; name: string }[]>([])
  const [selectedId,  setSelectedId]  = useState('')
  const [claiming,    setClaiming]    = useState(false)
  const [claimError,  setClaimError]  = useState('')
  const [loggingOut,  setLoggingOut]  = useState(false)
  const [reassigning, setReassigning] = useState(false)

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

    const { data: teams } = await supabase.from('teams').select('id, name').order('name')
    setAllTeams(teams ?? [])
    setTeamLoading(false)
  }, [supabase])

  useEffect(() => { loadTeam() }, [loadTeam])

  async function handleClaim() {
    if (!selectedId) return
    setClaiming(true); setClaimError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setClaimError('로그인 정보를 찾을 수 없습니다.'); setClaiming(false); return }

    if (reassigning) {
      await supabase.from('team_assignments').delete().eq('user_id', user.id)
    }

    const { error } = await supabase
      .from('team_assignments')
      .insert({ user_id: user.id, team_id: selectedId })

    if (error) {
      setClaimError(error.code === '23505' ? '이미 다른 사람이 등록한 업체입니다.' : error.message)
      setClaiming(false); return
    }
    onSubmit(selectedId)
  }

  async function handleSignOut() {
    setLoggingOut(true)
    sessionStorage.removeItem('admin_verified')
    await supabase.auth.signOut()
    onSignOut()
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

  // 업체 배정돼 있고 재선택 모드 아닐 때 → 입장 선택 화면
  if (myTeam && !reassigning) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <p className="text-xs text-gray-600 truncate">{email}</p>
          </div>

          <p className="text-sm font-semibold text-gray-900">어떻게 입장하시겠습니까?</p>

          <button
            onClick={() => onSubmit(myTeam.id)}
            className="w-full flex items-center justify-between px-4 py-4
                       bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-colors"
          >
            <div className="text-left">
              <p className="text-sm font-semibold">{myTeam.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">자료 제출 페이지</p>
            </div>
            <ChevronIcon />
          </button>

          <button
            onClick={onAdmin}
            className="flex items-center justify-between w-full px-4 py-4
                       bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl transition-colors"
          >
            <div className="text-left">
              <p className="text-sm font-semibold">관리자 대시보드</p>
              <p className="text-xs text-gray-400 mt-0.5">PIN 인증 후 입장</p>
            </div>
            <ChevronIcon />
          </button>

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

  // 업체 선택 / 재선택 UI
  return (
    <AuthShell>
      <div className="space-y-5">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <p className="text-xs text-gray-600 truncate">{email}</p>
        </div>

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

          {claimError && <p className="text-xs text-red-600">{claimError}</p>}

          <button
            onClick={handleClaim}
            disabled={!selectedId || claiming}
            className="w-full py-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-white
                       font-semibold text-sm transition-colors disabled:opacity-40"
          >
            {claiming ? '처리 중...' : '입장하기'}
          </button>
        </div>

        <div className="border-t border-gray-200 pt-4 space-y-2">
          <button
            onClick={onAdmin}
            className="flex items-center justify-between w-full px-4 py-3
                       bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg
                       transition-all group text-sm"
          >
            <span className="font-semibold">관리자 대시보드</span>
            <ChevronIcon />
          </button>

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
function LoginPanel({ onLoggedIn }: { onLoggedIn: (email: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [mode,     setMode]     = useState<AuthMode>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [sent,     setSent]     = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')

    const { data, error: authError } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (authError) { setError(authError.message); setLoading(false); return }
    if (mode === 'signup') { setSent(true); setLoading(false); return }
    if (data.session) onLoggedIn(data.session.user.email ?? email)
    setLoading(false)
  }

  async function handleMagicLink() {
    if (!email) { setError('이메일을 먼저 입력해 주세요.'); return }
    setLoading(true); setError('')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    if (authError) { setError(authError.message); setLoading(false); return }
    setSent(true); setLoading(false)
  }

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
      <div className="flex gap-8 border-b border-gray-200 mb-6">
        {(['login', 'signup'] as AuthMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError('') }}
            className={[
              'text-sm font-semibold pb-3 transition-colors relative',
              mode === m ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {m === 'login' ? '로그인' : '계정 만들기'}
            {mode === m && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900" />}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium">이메일</label>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm
                       outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900
                       placeholder:text-gray-400 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium">비밀번호</label>
          <input
            type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="6자 이상"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm
                       outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900
                       placeholder:text-gray-400 transition-colors"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full py-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-white
                     font-semibold text-sm transition-colors disabled:opacity-50"
        >
          {loading ? '처리 중...' : mode === 'login' ? '로그인' : '계정 만들기'}
        </button>
      </form>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-white text-xs text-gray-400">또는</span>
        </div>
      </div>

      <button
        type="button" onClick={handleMagicLink} disabled={loading}
        className="w-full py-3 rounded-lg border border-gray-200 hover:bg-gray-50
                   text-gray-600 font-medium text-sm transition-colors"
      >
        이메일 링크로 로그인
      </button>
    </AuthShell>
  )
}

// ── 공통 UI ──────────────────────────────────────────────────
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-900 mb-4">
          <span className="text-sm font-bold tracking-tight text-white">DABs</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">회의 자료 취합</h1>
        <p className="text-gray-500 text-sm mt-1">DABs 제출 및 관리 시스템</p>
      </div>
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        {children}
      </div>
    </main>
  )
}

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

function ChevronIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}
