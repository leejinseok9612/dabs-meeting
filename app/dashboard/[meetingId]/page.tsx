// ============================================================
// app/dashboard/[meetingId]/page.tsx
// DABs 관리자 실시간 모니터링 대시보드
// ============================================================
'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient }                             from '@/lib/supabase/client'
import { useParams, useRouter }                     from 'next/navigation'
import type { RealtimeChannel }                     from '@supabase/supabase-js'

// ── 고정 업체 순서 ─────────────────────────────────────────
const COMPANY_ORDER = ['천호엔지니어링', '참마루건설', '지디건설'] as const
type CompanyName = typeof COMPANY_ORDER[number]

function sortByCompanyOrder(submissions: SubmissionRow[]): SubmissionRow[] {
  return [...submissions].sort((a, b) => {
    const aName  = a.teams?.name ?? ''
    const bName  = b.teams?.name ?? ''
    const aIdx   = COMPANY_ORDER.indexOf(aName as CompanyName)
    const bIdx   = COMPANY_ORDER.indexOf(bName as CompanyName)
    const aOrder = aIdx === -1 ? COMPANY_ORDER.length : aIdx
    const bOrder = bIdx === -1 ? COMPANY_ORDER.length : bIdx
    return aOrder - bOrder
  })
}

// ── 타입 ─────────────────────────────────────────────────
interface PersonnelDetail {
  elderly:      number   // 고령자
  superElderly: number   // 초고령자
  foreign:      number   // 외국인 근로자
  female:       number   // 여성 근로자
  diseased:     number   // 유질환자
}

interface SubmissionRow {
  id:                string
  meeting_id:        string
  team_id:           string
  status:            'pending' | 'submitted' | 'rejected'
  personnel_count?:  number | null
  personnel_detail?: PersonnelDetail | null
  equipment?:        string | null
  work_process?:     string | null
  file_name?:        string | null
  submitted_at?:     string | null
  teams?: { id: string; name: string; department?: string | null }
}

interface Meeting {
  id:     string
  title:  string
  date:   string
  status: 'open' | 'closed'
}

type MergeStep = 'idle' | 'merging' | 'done' | 'error'

// ── 메인 컴포넌트 ────────────────────────────────────────
export default function DashboardPage() {
  const params    = useParams()
  const meetingId = params.meetingId as string
  const router    = useRouter()
  const supabase  = useMemo(() => createClient(), [])
  const channelRef = useRef<RealtimeChannel | null>(null)

  const [meeting,     setMeeting]     = useState<Meeting | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // 병합 상태
  const [mergeStep,    setMergeStep]    = useState<MergeStep>('idle')
  const [mergeError,   setMergeError]   = useState('')
  const [downloadUrl,  setDownloadUrl]  = useState('')

  // 지적도/공사현황도
  const [mapUrl,       setMapUrl]       = useState<string | null>(null)
  const [mapName,      setMapName]      = useState<string | null>(null)
  const [mapUploading, setMapUploading] = useState(false)
  const mapInputRef = useRef<HTMLInputElement>(null)

  // ── 통계 계산 ──────────────────────────────────────────
  const submitted   = submissions.filter(s => s.status === 'submitted')
  const totalPersonnel = submitted.reduce((sum, s) => sum + (s.personnel_count ?? 0), 0)
  const submittedCount = submitted.length
  const totalCompanies = COMPANY_ORDER.length     // 전체 등록 업체 수

  const progressPct = totalCompanies > 0
    ? Math.round((submittedCount / totalCompanies) * 100)
    : 0

  // ── 초기 데이터 로드 ──────────────────────────────────
  const loadData = useCallback(async () => {
    const [{ data: mtg }, { data: subs }] = await Promise.all([
      supabase
        .from('meetings')
        .select('id,title,date,status,map_file_url,map_file_name')
        .eq('id', meetingId)
        .single(),
      supabase
        .from('submissions')
        .select('id,meeting_id,team_id,status,personnel_count,personnel_detail,equipment,work_process,file_name,submitted_at,teams(id,name,department)')
        .eq('meeting_id', meetingId),
    ])

    if (!mtg) { router.push('/dashboard'); return }
    setMeeting(mtg as unknown as Meeting)
    setMapUrl((mtg as unknown as {map_file_url?: string}).map_file_url ?? null)
    setMapName((mtg as unknown as {map_file_name?: string}).map_file_name ?? null)
    setSubmissions((subs ?? []) as unknown as SubmissionRow[])
    setLastUpdated(new Date())
    setPageLoading(false)
  }, [meetingId, supabase, router])

  useEffect(() => { loadData() }, [loadData])

  // ── Supabase Realtime 구독 ────────────────────────────
  useEffect(() => {
    if (!meetingId) return

    const channel = supabase
      .channel(`dashboard:${meetingId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'submissions',
          filter: `meeting_id=eq.${meetingId}`,
        },
        async (payload) => {
          // 변경된 row를 팀 정보 포함해서 다시 조회
          const changedId =
            (payload.new as SubmissionRow)?.id ??
            (payload.old as SubmissionRow)?.id

          if (!changedId) return

          if (payload.eventType === 'DELETE') {
            setSubmissions(prev => prev.filter(s => s.id !== changedId))
            setLastUpdated(new Date())
            return
          }

          const { data: fresh } = await supabase
            .from('submissions')
            .select('id,meeting_id,team_id,status,personnel_count,personnel_detail,equipment,work_process,file_name,submitted_at,teams(id,name,department)')
            .eq('id', changedId)
            .single()

          if (!fresh) return

          setSubmissions(prev => {
            const exists = prev.find(s => s.id === fresh.id)
            return exists
              ? prev.map(s => s.id === fresh.id ? fresh as unknown as SubmissionRow : s)
              : [...prev, fresh as unknown as SubmissionRow]
          })
          setLastUpdated(new Date())
        }
      )
      .subscribe()

    channelRef.current = channel
    return () => { channel.unsubscribe() }
  }, [meetingId, supabase])

  // ── 지적도/공사현황도 업로드 ──────────────────────────
  async function handleMapUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !meeting) return
    setMapUploading(true)
    const fd = new FormData()
    fd.append('file', f)
    fd.append('meetingId', meeting.id)
    const res = await fetch('/api/upload-map', { method: 'POST', body: fd })
    if (res.ok) {
      const { url, name } = await res.json()
      setMapUrl(url); setMapName(name)
    }
    setMapUploading(false)
  }

  // ── 병합 실행 ─────────────────────────────────────────
  async function handleMerge() {
    if (submittedCount === 0) return
    setMergeStep('merging')
    setMergeError('')
    setDownloadUrl('')

    try {
      const res  = await fetch('/api/merge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ meetingId }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? '병합 실패')
      }
      setDownloadUrl(data.downloadUrl)
      setMergeStep('done')
    } catch (err: unknown) {
      setMergeError(err instanceof Error ? err.message : '알 수 없는 오류')
      setMergeStep('error')
    }
  }

  // ── 강제 다운로드 (Blob) ──────────────────────────────
  async function handleDownload() {
    if (!downloadUrl || !meeting) return
    try {
      const res  = await fetch(downloadUrl)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `DABs_${meeting.date}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      // 실패 시 새 탭에서 열기로 fallback
      window.open(downloadUrl, '_blank')
    }
  }

  // ── 로딩 ──────────────────────────────────────────────
  if (pageLoading) return <PageLoader />

  const sorted = sortByCompanyOrder(submissions)

  return (
    <div className="min-h-screen bg-slate-100">

      {/* ── 상단 헤더 바 ────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600
                         hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              회의 목록
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <div>
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-0.5">
                DABs 관리자 대시보드
              </p>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">
                {meeting?.title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Realtime 상태 표시 */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              실시간 연결됨
            </div>
            {lastUpdated && (
              <span className="text-xs text-slate-400">
                {lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 업데이트
              </span>
            )}
            <span className={[
              'text-xs font-medium px-2.5 py-1 rounded-full',
              meeting?.status === 'open'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-200 text-slate-500',
            ].join(' ')}>
              {meeting?.status === 'open' ? '접수중' : '마감'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── 통계 카드 3종 ───────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="총 투입 인원"
            value={totalPersonnel}
            unit="명"
            color="blue"
            icon={<PeopleIcon />}
          />
          <StatCard
            label="제출 완료 업체"
            value={submittedCount}
            unit={`/ ${totalCompanies}개`}
            color="emerald"
            icon={<CheckIcon />}
          />
          <StatCard
            label="제출 진행률"
            value={progressPct}
            unit="%"
            color={progressPct === 100 ? 'violet' : 'amber'}
            icon={<ChartIcon />}
            extra={
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={[
                    'h-full rounded-full transition-all duration-700',
                    progressPct === 100 ? 'bg-violet-500' : 'bg-amber-400',
                  ].join(' ')}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            }
          />
        </div>

        {/* ── 지적도/공사현황도 ────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-slate-700">🗺️ 지적도 / 공사현황도</h2>
              <p className="text-xs text-slate-400 mt-0.5">이 회의의 현장 도면 파일을 첨부합니다</p>
            </div>
            <div className="flex items-center gap-2">
              {mapUploading && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  업로드 중...
                </span>
              )}
              <input ref={mapInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.dwg"
                className="hidden" onChange={handleMapUpload} />
              <button onClick={() => mapInputRef.current?.click()} disabled={mapUploading}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {mapUrl ? '교체' : '파일 첨부'}
              </button>
            </div>
          </div>
          {mapUrl ? (
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
              <span className="text-xl">📁</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{mapName}</p>
              </div>
              <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2">
                열기
              </a>
            </div>
          ) : (
            <div className="border-2 border-dashed border-slate-200 rounded-xl py-8 text-center text-slate-400">
              <p className="text-3xl mb-2">🗺️</p>
              <p className="text-sm">첨부된 파일이 없습니다</p>
              <p className="text-xs mt-1">PDF, JPG, PNG, DWG 지원</p>
            </div>
          )}
        </section>

        {/* ── 제출 현황 테이블 ─────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">업체별 제출 현황</h2>
            <span className="text-xs text-slate-400">
              순서: {COMPANY_ORDER.join(' › ')}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-3 font-medium w-8">#</th>
                  <th className="text-left px-6 py-3 font-medium">업체명</th>
                  <th className="text-left px-4 py-3 font-medium">투입 인원</th>
                  <th className="text-left px-4 py-3 font-medium">작업공정</th>
                  <th className="text-left px-4 py-3 font-medium">투입 장비</th>
                  <th className="text-left px-4 py-3 font-medium">제출 파일</th>
                  <th className="text-left px-4 py-3 font-medium">제출 시간</th>
                  <th className="text-left px-4 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((sub, idx) => (
                  <SubmissionRow key={sub.id} row={sub} index={idx + 1} />
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400 text-sm">
                      아직 제출된 자료가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 병합 실행 섹션 ───────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-700 mb-1">PDF 병합 및 다운로드</h2>
              <p className="text-sm text-slate-400">
                표지 자동 생성 후 업체 자료를 순서대로 병합합니다.
                <br />
                <span className="text-xs">(표지 → 천호엔지니어링 → 참마루건설 → 지디건설)</span>
              </p>
            </div>

            <div className="flex flex-col items-end gap-3">
              {/* 병합 버튼 */}
              <button
                onClick={handleMerge}
                disabled={submittedCount === 0 || mergeStep === 'merging'}
                className={[
                  'inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm',
                  'transition-all shadow-sm',
                  submittedCount === 0 || mergeStep === 'merging'
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white',
                ].join(' ')}
              >
                {mergeStep === 'merging' ? (
                  <>
                    <Spinner />
                    병합 중...
                  </>
                ) : (
                  <>
                    <MergeIcon />
                    오늘의 DABs 자료 병합하기
                  </>
                )}
              </button>

              {/* 에러 */}
              {mergeStep === 'error' && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <span>⚠️</span> {mergeError}
                </p>
              )}

              {/* 다운로드 버튼 (표지 + 본문 통합) */}
              {mergeStep === 'done' && downloadUrl && (
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl
                             bg-emerald-600 hover:bg-emerald-700 text-white text-sm
                             font-semibold transition-colors shadow-sm"
                >
                  <DownloadIcon />
                  병합 완료 — PDF 다운로드 (표지 포함)
                </button>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────

function SubmissionRow({ row, index }: { row: SubmissionRow; index: number }) {
  const isSubmitted = row.status === 'submitted'
  const isPending   = row.status === 'pending'

  return (
    <tr className={[
      'transition-colors',
      isSubmitted ? 'bg-white hover:bg-emerald-50' : 'bg-slate-50/60 hover:bg-slate-50',
    ].join(' ')}>
      {/* 순번 */}
      <td className="px-6 py-4 text-slate-400 text-xs">{index}</td>

      {/* 업체명 */}
      <td className="px-6 py-4 font-medium text-slate-800">
        {row.teams?.name ?? '—'}
        {row.teams?.department && (
          <span className="ml-1.5 text-xs text-slate-400">({row.teams.department})</span>
        )}
      </td>

      {/* 투입 인원 */}
      <td className="px-4 py-4 text-slate-600 min-w-[130px]">
        {isSubmitted && row.personnel_count != null ? (
          <div className="space-y-1.5">
            {/* 총인원 뱃지 */}
            <div className="inline-flex items-baseline gap-0.5">
              <span className="text-base font-bold text-blue-600">{row.personnel_count}</span>
              <span className="text-xs font-normal text-slate-400">명</span>
            </div>
            {/* 세부 내역 */}
            {row.personnel_detail && (
              <div className="space-y-0.5">
                {(
                  [
                    { key: 'elderly',      label: '고령',   color: 'text-amber-600'  },
                    { key: 'superElderly', label: '초고령', color: 'text-amber-700'  },
                    { key: 'foreign',      label: '외국인', color: 'text-violet-600' },
                    { key: 'female',       label: '여성',   color: 'text-violet-600' },
                    { key: 'diseased',     label: '유질환', color: 'text-red-500'    },
                  ] as const
                )
                  .filter(item => (row.personnel_detail![item.key] ?? 0) > 0)
                  .map(item => (
                    <div key={item.key} className="flex items-center gap-1">
                      <span className={`text-[10px] font-medium ${item.color} w-12 shrink-0`}>{item.label}</span>
                      <span className="text-[10px] text-slate-500">{row.personnel_detail![item.key]}명</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* 작업공정 */}
      <td className="px-4 py-4 text-slate-500 text-xs">
        {row.work_process || <span className="text-slate-300">—</span>}
      </td>

      {/* 투입 장비 */}
      <td className="px-4 py-4 text-slate-500 text-xs max-w-[180px]">
        {row.equipment
          ? row.equipment.split(',').map((e, i) => (
              <span key={i} className="block leading-5">{e.trim()}</span>
            ))
          : <span className="text-slate-300">—</span>}
      </td>

      {/* 파일명 */}
      <td className="px-4 py-4 text-xs text-slate-400 max-w-[140px] truncate" title={row.file_name ?? ''}>
        {row.file_name
          ? <span className="flex items-center gap-1"><PdfSmallIcon />{row.file_name}</span>
          : <span className="text-slate-300">—</span>
        }
      </td>

      {/* 제출 시간 */}
      <td className="px-4 py-4 text-xs text-slate-400 whitespace-nowrap">
        {row.submitted_at
          ? new Date(row.submitted_at).toLocaleString('ko-KR', {
              month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })
          : <span className="text-slate-300">—</span>
        }
      </td>

      {/* 상태 배지 */}
      <td className="px-4 py-4">
        <StatusBadge status={row.status} />
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: SubmissionRow['status'] }) {
  const map = {
    submitted: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    pending:   'bg-amber-100  text-amber-700  ring-amber-200',
    rejected:  'bg-red-100    text-red-600    ring-red-200',
  } as const
  const label = { submitted: '제출완료', pending: '미제출', rejected: '반려' }

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ${map[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'submitted' ? 'bg-emerald-500 animate-pulse' :
        status === 'pending'   ? 'bg-amber-400' : 'bg-red-400'
      }`} />
      {label[status]}
    </span>
  )
}

function StatCard({
  label, value, unit, color, icon, extra,
}: {
  label: string
  value: number
  unit: string
  color: 'blue' | 'emerald' | 'amber' | 'violet'
  icon: React.ReactNode
  extra?: React.ReactNode
}) {
  const colorMap = {
    blue:    { bg: 'bg-blue-50',   icon: 'text-blue-500',   value: 'text-blue-700' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-500', value: 'text-emerald-700' },
    amber:   { bg: 'bg-amber-50',  icon: 'text-amber-500',  value: 'text-amber-700' },
    violet:  { bg: 'bg-violet-50', icon: 'text-violet-500', value: 'text-violet-700' },
  }
  const c = colorMap[color]

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-slate-500 font-medium">{label}</p>
        <span className={`${c.bg} ${c.icon} p-2 rounded-lg`}>{icon}</span>
      </div>
      <p className={`text-4xl font-bold ${c.value} leading-none`}>
        {value.toLocaleString()}
        <span className="text-base font-medium text-slate-400 ml-1.5">{unit}</span>
      </p>
      {extra}
    </div>
  )
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">대시보드 불러오는 중...</p>
      </div>
    </div>
  )
}

// ── 아이콘 ───────────────────────────────────────────────

function PeopleIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

function MergeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M7.5 7.5h-.75A2.25 2.25 0 004.5 9.75v7.5a2.25 2.25 0 002.25 2.25h7.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25h-.75m-6 3.75l3 3m0 0l3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-7.5a2.25 2.25 0 01-2.25-2.25v-.75" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}

function PdfSmallIcon() {
  return (
    <svg className="w-3 h-3 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function Spinner() {
  return (
    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
  )
}
