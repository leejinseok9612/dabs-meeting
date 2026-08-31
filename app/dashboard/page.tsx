// ============================================================
// app/dashboard/page.tsx  —  관리자 회의 목록 + 생성 화면
// ============================================================
'use client'

import { useState, useEffect, useMemo, FormEvent, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import PinGate from '@/app/components/PinGate'

// ── 타입 ────────────────────────────────────────────────────
interface Meeting {
  id:          string
  title:       string
  date:        string
  description: string | null
  status:      'open' | 'closed'
  created_at:  string
  // 집계
  total_count:     number   // 전체 등록 팀 수
  submitted_count: number   // 제출 완료 수
}

interface Team {
  id:   string
  name: string
}

// ── 상수 ────────────────────────────────────────────────────
const TODAY = new Date().toISOString().split('T')[0]  // YYYY-MM-DD

// 이번 달 첫째 날 (기간 선택 기본값)
function thisMonthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ── 메인 ────────────────────────────────────────────────────
export default function AdminMeetingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const router   = useRouter()

  // PIN 인증
  const [pinVerified, setPinVerified] = useState(false)

  const [meetings,     setMeetings]     = useState<Meeting[]>([])
  const [teams,        setTeams]        = useState<Team[]>([])
  const [pageLoading,  setPageLoading]  = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [adminEmail,   setAdminEmail]   = useState('')
  const [copiedId,     setCopiedId]     = useState<string | null>(null)

  // 폼 상태
  const [title,       setTitle]       = useState(`DABs 회의 ${TODAY}`)
  const [date,        setDate]        = useState(TODAY)
  const [description, setDescription] = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [formError,   setFormError]   = useState('')

  // 자동 생성 트리거 상태
  const [autoCreating, setAutoCreating] = useState(false)
  const [autoMsg,      setAutoMsg]      = useState('')

  // 기간별 PDF 다운로드 상태
  const [rangeStart,       setRangeStart]       = useState(thisMonthStart())
  const [rangeEnd,         setRangeEnd]         = useState(TODAY)
  const [rangeDownloading, setRangeDownloading] = useState(false)
  const [rangeError,       setRangeError]       = useState('')

  // 공지사항 관리
  const [announcements,    setAnnouncements]    = useState<{id: string; title: string; content: string; is_active: boolean}[]>([])
  const [showAnnoForm,     setShowAnnoForm]     = useState(false)
  const [annoTitle,        setAnnoTitle]        = useState('')
  const [annoContent,      setAnnoContent]      = useState('')
  const [annoSaving,       setAnnoSaving]       = useState(false)

  // ── 공지사항 로드 ────────────────────────────────────────
  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(data => Array.isArray(data) && setAnnouncements(data))
      .catch(() => {})
  }, [])

  async function handleAnnoAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!annoTitle.trim() || !annoContent.trim()) return
    setAnnoSaving(true)
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: annoTitle, content: annoContent, is_active: true }),
    })
    const item = await res.json()
    setAnnouncements(prev => [item, ...prev])
    setAnnoTitle(''); setAnnoContent(''); setShowAnnoForm(false); setAnnoSaving(false)
  }

  async function handleAnnoToggle(id: string, is_active: boolean) {
    await fetch('/api/announcements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !is_active }),
    })
    setAnnouncements(prev => prev.map(a => a.id === id ? { ...a, is_active: !is_active } : a))
  }

  async function handleAnnoDelete(id: string) {
    await fetch(`/api/announcements?id=${id}`, { method: 'DELETE' })
    setAnnouncements(prev => prev.filter(a => a.id !== id))
  }

  // ── 데이터 로드 ──────────────────────────────────────────
  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/'); return }
    setAdminEmail(user?.email ?? '')

    // 팀 목록 로드
    const { data: tms } = await supabase
      .from('teams')
      .select('id,name')
      .order('name')
    setTeams(tms ?? [])

    const { data: mtgs } = await supabase
      .from('meetings')
      .select('id,title,date,description,status,created_at')
      .order('date', { ascending: false })

    if (!mtgs) { setPageLoading(false); return }

    const enriched: Meeting[] = await Promise.all(
      mtgs.map(async (m) => {
        const { data: subs } = await supabase
          .from('submissions')
          .select('status')
          .eq('meeting_id', m.id)

        const total     = subs?.length ?? 0
        const submitted = subs?.filter(s => s.status === 'submitted').length ?? 0
        return { ...m, total_count: total, submitted_count: submitted }
      })
    )

    setMeetings(enriched)
    setPageLoading(false)
  }

  // PIN 인증 후에만 데이터 로드
  useEffect(() => { if (pinVerified) loadData() }, [supabase, pinVerified])

  // ── 회의 생성 ────────────────────────────────────────────
  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !date) { setFormError('회의명과 날짜는 필수입니다.'); return }

    setSubmitting(true)
    setFormError('')

    const { data: { user } } = await supabase.auth.getUser()

    const { data: newMeeting, error } = await supabase
      .from('meetings')
      .insert({
        title:       title.trim(),
        date,
        description: description.trim() || null,
        status:      'open',
        created_by:  user?.id,
      })
      .select()
      .single()

    if (error || !newMeeting) {
      setFormError(error?.message ?? '생성 실패')
      setSubmitting(false)
      return
    }

    // teams 테이블에서 업체 목록 조회 → submissions 슬롯 자동 생성
    const { data: teams } = await supabase
      .from('teams')
      .select('id')

    if (teams && teams.length > 0) {
      await supabase.from('submissions').insert(
        teams.map((t, idx) => ({
          meeting_id:  newMeeting.id,
          team_id:     t.id,
          order_index: idx,
          status:      'pending',
        }))
      )
    }

    // 목록 갱신 + 폼 닫기 + 바로 해당 대시보드로 이동
    setShowForm(false)
    router.push(`/dashboard/${newMeeting.id}`)
  }

  // ── 회의 상태 토글 (open ↔ closed) ───────────────────────
  async function toggleStatus(m: Meeting) {
    const next = m.status === 'open' ? 'closed' : 'open'
    await supabase.from('meetings').update({ status: next }).eq('id', m.id)
    setMeetings(prev =>
      prev.map(item => item.id === m.id ? { ...item, status: next } : item)
    )
  }

  // ── 오늘 회의 자동 생성 (수동 트리거) ───────────────────
  async function handleAutoCreate() {
    setAutoCreating(true)
    setAutoMsg('')
    try {
      // 세션 인증 기반 API 사용 (CRON_SECRET 브라우저 노출 없음)
      const res  = await fetch('/api/admin/trigger-daily-meeting', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setAutoMsg(`✅ ${data.title} 생성 완료!`)
        await loadData()
      } else {
        setAutoMsg(`ℹ️ ${data.message ?? data.error}`)
      }
    } catch {
      setAutoMsg('❌ 오류가 발생했습니다.')
    }
    setAutoCreating(false)
  }

  // ── 고정 링크 복사 ───────────────────────────────────────
  function copyLink(teamId: string) {
    const url = `${window.location.origin}/submit/${teamId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(teamId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  // ── 기간별 PDF 일괄 다운로드 ─────────────────────────────
  async function handleRangeDownload() {
    setRangeDownloading(true)
    setRangeError('')
    try {
      const res = await fetch('/api/merge-range', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ startDate: rangeStart, endDate: rangeEnd }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? '다운로드 실패')
      }

      // Blob → 강제 다운로드
      const blob     = await res.blob()
      const url      = URL.createObjectURL(blob)
      const a        = document.createElement('a')
      a.href         = url
      a.download     = `DABs_${rangeStart}_${rangeEnd}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setRangeError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    }
    setRangeDownloading(false)
  }

  // ── 로그아웃 ─────────────────────────────────────────────
  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/')
  }

  // PIN 인증 화면
  if (!pinVerified) return <PinGate onSuccess={() => setPinVerified(true)} />

  if (pageLoading) return <PageLoader />

  const todayMeetings  = meetings.filter(m => m.date === TODAY)
  const otherMeetings  = meetings.filter(m => m.date !== TODAY)

  return (
    <div className="min-h-screen bg-slate-100">

      {/* ── 헤더 ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <span className="text-lg">📋</span>
            </div>
            <div>
              <h1 className="font-bold text-slate-800 leading-tight">DABs 관리자</h1>
              <p className="text-xs text-slate-400">{adminEmail}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowForm(true); setFormError('') }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700
                         text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
            >
              <PlusIcon /> 새 회의 만들기
            </button>
            <button
              onClick={handleSignOut}
              className="px-3 py-2 text-sm text-slate-500 hover:text-red-500
                         border border-slate-200 rounded-lg transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* ── 오늘의 회의 ────────────────────────────────── */}
        {todayMeetings.length > 0 && (
          <section>
            <SectionLabel label="오늘의 회의" badge={`${TODAY}`} color="blue" />
            <div className="space-y-3">
              {todayMeetings.map(m => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  highlight
                  onToggle={() => toggleStatus(m)}
                  onClick={() => router.push(`/dashboard/${m.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 이전 회의 ───────────────────────────────────── */}
        {otherMeetings.length > 0 && (
          <section>
            <SectionLabel label="이전 회의" badge={`${otherMeetings.length}개`} color="slate" />
            <div className="space-y-3">
              {otherMeetings.map(m => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  highlight={false}
                  onToggle={() => toggleStatus(m)}
                  onClick={() => router.push(`/dashboard/${m.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 업체 고정 제출 링크 ──────────────────────────── */}
        {teams.length > 0 && (
          <section>
            <SectionLabel label="업체 고정 제출 링크" badge="복사해서 공유" color="slate" />
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {teams.map(t => {
                const url = typeof window !== 'undefined'
                  ? `${window.location.origin}/submit/${t.id}`
                  : `/submit/${t.id}`
                return (
                  <div key={t.id} className="flex items-center justify-between px-5 py-3.5 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700">{t.name}</p>
                      <p className="text-xs text-slate-400 truncate">/submit/{t.id}</p>
                    </div>
                    <button
                      onClick={() => copyLink(t.id)}
                      className={[
                        'shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        copiedId === t.id
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700',
                      ].join(' ')}
                    >
                      {copiedId === t.id ? '✅ 복사됨!' : '🔗 링크 복사'}
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-slate-400 mt-2 px-1">
              이 링크는 영구적으로 유효합니다. 업체 담당자에게 한 번만 공유하세요.
            </p>
          </section>
        )}

        {/* ── 기간별 PDF 일괄 다운로드 ─────────────────────── */}
        <section>
          <SectionLabel label="기간별 PDF 일괄 다운로드" badge="병합 완료된 회의만" color="slate" />
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <p className="text-xs text-slate-400">
              선택한 기간 내에 병합이 완료된 각 회의의 PDF를 날짜순으로 합쳐서 한 번에 다운로드합니다.
            </p>

            {/* 날짜 선택 행 */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500">시작일</label>
                <input
                  type="date"
                  value={rangeStart}
                  max={rangeEnd}
                  onChange={e => setRangeStart(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800
                             outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <span className="text-slate-400 text-sm pb-2">~</span>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500">종료일</label>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart}
                  max={TODAY}
                  onChange={e => setRangeEnd(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800
                             outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleRangeDownload}
                disabled={rangeDownloading}
                className={[
                  'inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold',
                  'transition-colors shadow-sm',
                  rangeDownloading
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white',
                ].join(' ')}
              >
                {rangeDownloading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    다운로드 중...
                  </>
                ) : (
                  <>
                    <DownloadRangeIcon />
                    기간별 PDF 다운로드
                  </>
                )}
              </button>
            </div>

            {rangeError && (
              <p className="text-xs text-red-500 flex items-center gap-1.5">
                <span>⚠️</span>{rangeError}
              </p>
            )}
          </div>
        </section>

        {/* ── 공지사항 관리 ────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel label="공지사항 관리" badge="협력업체 로그인 시 팝업" color="slate" />
            <button
              onClick={() => setShowAnnoForm(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              + 공지 추가
            </button>
          </div>

          {showAnnoForm && (
            <div className="bg-white rounded-xl border border-amber-200 p-5 mb-3 shadow-sm">
              <form onSubmit={handleAnnoAdd} className="space-y-3">
                <input
                  type="text" placeholder="공지 제목"
                  value={annoTitle} onChange={e => setAnnoTitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
                <textarea
                  rows={3} placeholder="공지 내용"
                  value={annoContent} onChange={e => setAnnoContent(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAnnoForm(false)}
                    className="flex-1 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">취소</button>
                  <button type="submit" disabled={annoSaving}
                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                    {annoSaving ? '저장 중...' : '공지 등록'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {announcements.length === 0 ? (
            <p className="text-sm text-slate-400 px-1">등록된 공지사항이 없습니다.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {announcements.map(a => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{a.title}</p>
                    <p className="text-xs text-slate-400 truncate">{a.content}</p>
                  </div>
                  <button
                    onClick={() => handleAnnoToggle(a.id, a.is_active)}
                    className={[
                      'shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors',
                      a.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-400',
                    ].join(' ')}
                  >
                    {a.is_active ? '활성' : '비활성'}
                  </button>
                  <button onClick={() => handleAnnoDelete(a.id)}
                    className="text-slate-300 hover:text-red-400 transition-colors text-sm">✕</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 빈 상태 */}
        {meetings.length === 0 && (
          <div className="text-center py-20">
            <p className="text-4xl mb-4">📭</p>
            <p className="text-slate-500">아직 등록된 회의가 없습니다.</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold
                         rounded-lg hover:bg-blue-700 transition-colors"
            >
              첫 회의 만들기
            </button>
          </div>
        )}
      </main>

      {/* ── 회의 생성 모달 ───────────────────────────────── */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50
                     flex items-center justify-center px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8
                          animate-[fadeInUp_0.2s_ease]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800">새 회의 만들기</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <CloseIcon />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-5">
              {/* 회의명 */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  회의명 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="예) DABs 회의 2025-03-21"
                  className={inputCls}
                />
              </div>

              {/* 날짜 */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  회의 날짜 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* 설명 */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  설명 <span className="text-slate-400 font-normal">(선택)</span>
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="회의 안건이나 특이사항을 입력하세요"
                  className={inputCls + ' resize-none'}
                />
              </div>

              {/* 안내 박스 */}
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
                회의 생성 시 등록된 모든 업체의 제출 슬롯이 자동으로 만들어집니다.
              </div>

              {formError && (
                <p className="text-xs text-red-500 flex gap-1"><span>⚠️</span>{formError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600
                             text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700
                             text-white text-sm font-semibold transition-colors
                             disabled:opacity-50"
                >
                  {submitting ? '생성 중...' : '회의 생성 →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────

function MeetingCard({
  meeting, highlight, onToggle, onClick,
}: {
  meeting: Meeting
  highlight: boolean
  onToggle: () => void
  onClick: () => void
}) {
  const pct = meeting.total_count > 0
    ? Math.round((meeting.submitted_count / meeting.total_count) * 100)
    : 0

  return (
    <div
      onClick={onClick}
      className={[
        'group cursor-pointer rounded-xl border p-5 transition-all',
        'hover:shadow-md hover:-translate-y-0.5',
        highlight
          ? 'bg-white border-blue-200 shadow-sm shadow-blue-100'
          : 'bg-white border-slate-200',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* 제목 */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-slate-800 truncate group-hover:text-blue-600 transition-colors">
              {meeting.title}
            </h3>
            {highlight && (
              <span className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full">
                오늘
              </span>
            )}
          </div>

          {/* 날짜 + 설명 */}
          <p className="text-sm text-slate-400">
            {new Date(meeting.date).toLocaleDateString('ko-KR', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
          {meeting.description && (
            <p className="text-xs text-slate-400 mt-1 truncate">{meeting.description}</p>
          )}

          {/* 프로그레스 바 */}
          {meeting.total_count > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>제출 현황</span>
                <span className="font-medium text-slate-600">
                  {meeting.submitted_count}/{meeting.total_count}개 업체
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={[
                    'h-full rounded-full transition-all duration-500',
                    pct === 100 ? 'bg-emerald-500' : highlight ? 'bg-blue-500' : 'bg-slate-400',
                  ].join(' ')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 우측: 상태 배지 + 토글 */}
        <div
          className="flex flex-col items-end gap-2 shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <span className={[
            'text-xs font-semibold px-2.5 py-1 rounded-full',
            meeting.status === 'open'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-200 text-slate-500',
          ].join(' ')}>
            {meeting.status === 'open' ? '접수중' : '마감'}
          </span>
          <button
            onClick={onToggle}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            {meeting.status === 'open' ? '마감 처리' : '재오픈'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ label, badge, color }: {
  label: string
  badge: string
  color: 'blue' | 'slate'
}) {
  const c = color === 'blue'
    ? 'bg-blue-100 text-blue-600'
    : 'bg-slate-200 text-slate-500'
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-semibold text-slate-600">{label}</h2>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c}`}>{badge}</span>
    </div>
  )
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">불러오는 중...</p>
      </div>
    </div>
  )
}

// ── 스타일/아이콘 헬퍼 ───────────────────────────────────────
const inputCls =
  'w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-800 ' +
  'outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ' +
  'placeholder:text-slate-300 transition-colors'

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function DownloadRangeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}
