// ============================================================
// app/dashboard/[meetingId]/page.tsx
// DABs 관리자 실시간 모니터링 대시보드
// ============================================================
'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient }                             from '@/lib/supabase/client'
import { useParams, useRouter }                     from 'next/navigation'
import type { RealtimeChannel }                     from '@supabase/supabase-js'
import PinGate                                      from '@/app/components/PinGate'
import MapAnnotator                                 from '@/app/components/MapAnnotator'

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

interface WorkItem {
  id: string; work_type: 'high_risk' | 'general'; team_id: string
  work_name: string; location?: string; worker_count: number; description?: string
  teams?: { id: string; name: string }
}
interface MaterialReservation {
  id: string; team_id: string; material_description?: string
  quantity?: string; vehicle_type?: string; teams?: { id: string; name: string }
}
interface MaterialSlot {
  id: string; slot_time: string; max_teams: number
  material_reservations: MaterialReservation[]
}

// ── 메인 컴포넌트 ────────────────────────────────────────
export default function DashboardPage() {
  const params    = useParams()
  const meetingId = params.meetingId as string
  const router    = useRouter()
  const supabase  = useMemo(() => createClient(), [])
  const channelRef = useRef<RealtimeChannel | null>(null)

  // PIN 인증
  const [pinVerified, setPinVerified] = useState(false)

  const [meeting,     setMeeting]     = useState<Meeting | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // 지적도/공사현황도
  const [mapUrl,       setMapUrl]       = useState<string | null>(null)
  const [mapName,      setMapName]      = useState<string | null>(null)
  const [mapUploading, setMapUploading] = useState(false)
  const [mapError,     setMapError]     = useState<string | null>(null)
  const mapInputRef = useRef<HTMLInputElement>(null)

  // 전체 팀 목록 (MapAnnotator 범례용)
  const [allTeams, setAllTeams] = useState<{id:string;name:string}[]>([])

  // 작업 현황 & 자재 슬롯
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [slots,     setSlots]     = useState<MaterialSlot[]>([])
  const [openSection, setOpenSection] = useState<'high_risk'|'general'|'material'|null>(null)

  const loadWorkItems = useCallback(() => {
    fetch(`/api/work-items?meetingId=${meetingId}`)
      .then(r => r.json()).then(d => Array.isArray(d) && setWorkItems(d)).catch(() => {})
  }, [meetingId])

  const loadSlots = useCallback(() => {
    fetch(`/api/material-slots?meetingId=${meetingId}`)
      .then(r => r.json()).then(d => Array.isArray(d) && setSlots(d)).catch(() => {})
  }, [meetingId])

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

    const mtgAny = mtg as unknown as { map_file_url?: string; map_file_name?: string }
    let mapFileUrl  = mtgAny.map_file_url  ?? null
    let mapFileName = mtgAny.map_file_name ?? null

    // 현재 회의에 지적도가 없으면 가장 최근에 업로드된 지적도를 자동으로 가져옴
    if (!mapFileUrl) {
      const { data: latest } = await supabase
        .from('meetings')
        .select('map_file_url,map_file_name')
        .neq('id', meetingId)
        .not('map_file_url', 'is', null)
        .order('date', { ascending: false })
        .limit(1)
        .single()

      if (latest?.map_file_url) {
        mapFileUrl  = (latest as unknown as { map_file_url: string }).map_file_url
        mapFileName = (latest as unknown as { map_file_name?: string }).map_file_name ?? null

        // 현재 회의에도 저장해 다음 로드 시 바로 표시
        await supabase
          .from('meetings')
          .update({ map_file_url: mapFileUrl, map_file_name: mapFileName })
          .eq('id', meetingId)
      }
    }

    setMapUrl(mapFileUrl)
    setMapName(mapFileName)
    setSubmissions((subs ?? []) as unknown as SubmissionRow[])
    setLastUpdated(new Date())
    setPageLoading(false)
  }, [meetingId, supabase, router])

  useEffect(() => {
    if (pinVerified) {
      loadData()
      loadWorkItems()
      loadSlots()
      fetch('/api/teams').then(r => r.json()).then(d => Array.isArray(d) && setAllTeams(d)).catch(() => {})
    }
  }, [loadData, loadWorkItems, loadSlots, pinVerified])

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

  // 작업항목 실시간 구독
  useEffect(() => {
    if (!meetingId) return
    const ch = supabase
      .channel(`admin_work:${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items',
        filter: `meeting_id=eq.${meetingId}` }, () => loadWorkItems())
      .subscribe()
    return () => { ch.unsubscribe() }
  }, [meetingId, supabase, loadWorkItems])

  // 자재예약 실시간 구독
  useEffect(() => {
    if (!meetingId) return
    const ch = supabase
      .channel(`admin_material:${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_reservations' },
        () => loadSlots())
      .subscribe()
    return () => { ch.unsubscribe() }
  }, [meetingId, supabase, loadSlots])

  // ── 지적도/공사현황도 업로드 ──────────────────────────
  async function handleMapUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !meeting) return
    setMapUploading(true)
    setMapError(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('meetingId', meeting.id)
      const res = await fetch('/api/upload-map', { method: 'POST', body: fd })
      if (res.ok) {
        const { url, name } = await res.json()
        setMapUrl(url); setMapName(name)
      } else {
        const err = await res.json().catch(() => ({}))
        setMapError(err.error ?? '업로드에 실패했습니다.')
      }
    } catch {
      setMapError('네트워크 오류가 발생했습니다.')
    }
    setMapUploading(false)
  }

  // ── PIN 인증 / 로딩 ────────────────────────────────────
  if (!pinVerified) return <PinGate onSuccess={() => setPinVerified(true)} />
  if (pageLoading)  return <PageLoader />

  const sorted = sortByCompanyOrder(submissions)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 상단 헤더 바 ────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900
                         px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              회의 목록
            </button>
            <div className="w-px h-6 bg-gray-200" />
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">
                DABs 관리자 대시보드
              </p>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                {meeting?.title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Realtime 상태 표시 */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              실시간 연결됨
            </div>
            {lastUpdated && (
              <span className="text-xs text-gray-500">
                {lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 업데이트
              </span>
            )}
            <span className={[
              'text-xs font-medium px-2.5 py-1 rounded-full',
              meeting?.status === 'open'
                ? 'text-emerald-600'
                : 'text-gray-400',
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
            icon={<PeopleIcon />}
          />
          <StatCard
            label="제출 완료 업체"
            value={submittedCount}
            unit={`/ ${totalCompanies}개`}
            icon={<CheckIcon />}
          />
          <StatCard
            label="제출 진행률"
            value={progressPct}
            unit="%"
            icon={<ChartIcon />}
            extra={
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 bg-gray-900"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            }
          />
        </div>

        {/* ── 지적도/공사현황도 ────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">지적도 / 공사현황도</h2>
              <p className="text-xs text-gray-500 mt-0.5">이 회의의 현장 도면 파일을 첨부합니다</p>
            </div>
            <div className="flex items-center gap-2">
              {mapUploading && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <span className="w-3 h-3 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                  업로드 중...
                </span>
              )}
              <input ref={mapInputRef} type="file" accept=".jpg,.jpeg,.png"
                className="hidden" onChange={handleMapUpload} />
              <button onClick={() => mapInputRef.current?.click()} disabled={mapUploading}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {mapUrl ? '교체' : '파일 첨부'}
              </button>
            </div>
          </div>
          {mapError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              ⚠️ {mapError}
            </div>
          )}
          {mapUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{mapName}</p>
                  <p className="text-xs text-gray-500">아이콘을 드래그&드랍해서 장비·작업구역을 표시하세요</p>
                </div>
                <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2 whitespace-nowrap">
                  원본보기
                </a>
              </div>
              {/* 지도 인터랙션 (관리자도 마커 추가/삭제 가능) */}
              <MapAnnotator
                meetingId={meetingId}
                mapUrl={mapUrl}
                myTeamId=""
                allTeamIds={allTeams.map(t => t.id)}
                readOnly={false}
              />
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 rounded-xl py-8 text-center text-gray-400">
              <p className="text-sm mb-2">지적도 없음</p>
              <p className="text-sm text-gray-400">첨부된 파일이 없습니다</p>
              <p className="text-xs mt-1 text-gray-400">JPG, PNG 이미지 파일을 업로드하세요</p>
              <p className="text-xs mt-0.5 text-gray-300">업체들이 이 이미지 위에 드래그&드랍으로 장비를 표시합니다</p>
            </div>
          )}
        </section>

        {/* ── 작업 현황 / 자재 하역 3섹션 ─────────────────── */}
        {(
          [
            { key: 'high_risk', label: '고위험 작업 현황',
              count: workItems.filter(w => w.work_type === 'high_risk').length },
            { key: 'general',   label: '일반 작업 현황',
              count: workItems.filter(w => w.work_type === 'general').length },
            { key: 'material',  label: '자재 하역/운반',
              count: slots.reduce((acc, s) => acc + (s.material_reservations?.length ?? 0), 0) },
          ] as const
        ).map(({ key, label, count }) => (
          <section key={key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* 헤드라인 클릭 → 열기/닫기 */}
            <button
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
              onClick={() => setOpenSection(prev => prev === key ? null : key)}
            >
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-900">{label}</h2>
                <span className={[
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  count > 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400',
                ].join(' ')}>
                  {count}건
                </span>
              </div>
              <ChevronIcon open={openSection === key} />
            </button>

            {openSection === key && (
              <div className="border-t border-gray-100">
                {key === 'high_risk' && (
                  <WorkItemSection
                    items={workItems.filter(w => w.work_type === 'high_risk')}
                    color="red"
                  />
                )}
                {key === 'general' && (
                  <WorkItemSection
                    items={workItems.filter(w => w.work_type === 'general')}
                    color="gray"
                  />
                )}
                {key === 'material' && (
                  <MaterialSection slots={slots} />
                )}
              </div>
            )}
          </section>
        ))}

        {/* ── 제출 현황 테이블 ─────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">업체별 제출 현황</h2>
            <span className="text-xs text-gray-400">
              순서: {COMPANY_ORDER.join(' › ')}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide border-b border-gray-100">
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
              <tbody className="divide-y divide-gray-100">
                {sorted.map((sub, idx) => (
                  <SubmissionRow key={sub.id} row={sub} index={idx + 1} />
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 text-sm">
                      아직 제출된 자료가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>


      </main>
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────

// ── 아코디언 아이콘 ───────────────────────────────────────
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={['w-4 h-4 text-gray-400 transition-transform', open ? 'rotate-180' : ''].join(' ')}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ── 고위험/일반 작업 현황 ──────────────────────────────────
function WorkItemSection({ items, color }: { items: WorkItem[]; color: 'red'|'gray' }) {
  if (items.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-gray-400 text-sm">
        등록된 작업이 없습니다.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
            <th className="text-left px-6 py-3 font-medium">업체명</th>
            <th className="text-left px-4 py-3 font-medium">작업명</th>
            <th className="text-left px-4 py-3 font-medium">위치/구간</th>
            <th className="text-left px-4 py-3 font-medium">투입 인원</th>
            <th className="text-left px-4 py-3 font-medium">상세 내용</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(item => (
            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                <span className={[
                  'inline-block w-1.5 h-4 rounded-full mr-2 align-middle',
                  color === 'red' ? 'bg-red-400' : 'bg-blue-400',
                ].join(' ')} />
                {item.teams?.name ?? '—'}
              </td>
              <td className="px-4 py-3 text-gray-800 font-medium">{item.work_name}</td>
              <td className="px-4 py-3 text-gray-500 text-xs">{item.location || '—'}</td>
              <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                {item.worker_count > 0 ? `${item.worker_count}명` : '—'}
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs max-w-[220px]">
                {item.description || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 자재 하역/운반 현황 테이블 ─────────────────────────────
function MaterialSection({ slots }: { slots: MaterialSlot[] }) {
  const hasAny = slots.some(s => (s.material_reservations?.length ?? 0) > 0)
  if (!hasAny) {
    return (
      <div className="px-6 py-10 text-center text-gray-400 text-sm">
        예약된 자재 하역이 없습니다.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
            <th className="text-left px-6 py-3 font-medium">신청 시간</th>
            <th className="text-left px-4 py-3 font-medium">업체명</th>
            <th className="text-left px-4 py-3 font-medium">자재 내용</th>
            <th className="text-left px-4 py-3 font-medium">수량/규격</th>
            <th className="text-left px-4 py-3 font-medium">차량 종류</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {slots.flatMap(slot =>
            (slot.material_reservations ?? []).map(r => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                  {slot.slot_time}
                </td>
                <td className="px-4 py-3 text-gray-800 font-medium whitespace-nowrap">
                  {r.teams?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {r.material_description || '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {r.quantity || '—'}
                </td>
                <td className="px-4 py-3">
                  {r.vehicle_type
                    ? <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">
                        {r.vehicle_type}
                      </span>
                    : <span className="text-gray-300 text-xs">—</span>
                  }
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function SubmissionRow({ row, index }: { row: SubmissionRow; index: number }) {
  const isSubmitted = row.status === 'submitted'
  const isPending   = row.status === 'pending'

  return (
    <tr className={[
      'transition-colors hover:bg-gray-50',
      isSubmitted ? 'bg-white' : 'bg-gray-50',
    ].join(' ')}>
      {/* 순번 */}
      <td className="px-6 py-4 text-gray-400 text-xs">{index}</td>

      {/* 업체명 */}
      <td className="px-6 py-4 font-medium text-gray-900">
        {row.teams?.name ?? '—'}
        {row.teams?.department && (
          <span className="ml-1.5 text-xs text-gray-400">({row.teams.department})</span>
        )}
      </td>

      {/* 투입 인원 */}
      <td className="px-4 py-4 text-gray-600 min-w-[130px]">
        {isSubmitted && row.personnel_count != null ? (
          <div className="space-y-1.5">
            {/* 총인원 뱃지 */}
            <div className="inline-flex items-baseline gap-0.5">
              <span className="text-xl font-bold text-gray-900">{row.personnel_count}</span>
              <span className="text-xs font-normal text-gray-400">명</span>
            </div>
            {/* 세부 내역 */}
            {row.personnel_detail && (
              <div className="space-y-0.5">
                {(
                  [
                    { key: 'elderly',      label: '고령'   },
                    { key: 'superElderly', label: '초고령' },
                    { key: 'foreign',      label: '외국인' },
                    { key: 'female',       label: '여성'   },
                    { key: 'diseased',     label: '유질환' },
                  ] as const
                )
                  .filter(item => (row.personnel_detail![item.key] ?? 0) > 0)
                  .map(item => (
                    <div key={item.key} className="flex items-center gap-1">
                      <span className="text-[10px] font-medium text-gray-500 w-12 shrink-0">{item.label}</span>
                      <span className="text-[10px] text-gray-400">{row.personnel_detail![item.key]}명</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      {/* 작업공정 */}
      <td className="px-4 py-4 text-gray-500 text-xs">
        {row.work_process || <span className="text-gray-300">—</span>}
      </td>

      {/* 투입 장비 */}
      <td className="px-4 py-4 text-gray-500 text-xs max-w-[180px]">
        {row.equipment
          ? row.equipment.split(',').map((e, i) => (
              <span key={i} className="block leading-5">{e.trim()}</span>
            ))
          : <span className="text-gray-300">—</span>}
      </td>

      {/* 파일명 */}
      <td className="px-4 py-4 text-xs text-gray-400 max-w-[140px] truncate" title={row.file_name ?? ''}>
        {row.file_name
          ? <span className="flex items-center gap-1"><PdfSmallIcon />{row.file_name}</span>
          : <span className="text-gray-300">—</span>
        }
      </td>

      {/* 제출 시간 */}
      <td className="px-4 py-4 text-xs text-gray-400 whitespace-nowrap">
        {row.submitted_at
          ? new Date(row.submitted_at).toLocaleString('ko-KR', {
              month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })
          : <span className="text-gray-300">—</span>
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
    submitted: { bg: 'bg-gray-900', text: 'text-white', dot: 'bg-white' },
    pending:   { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' },
    rejected:  { bg: 'bg-red-50', text: 'text-red-600 border border-red-100', dot: 'bg-red-400' },
  } as const
  const label = { submitted: '제출완료', pending: '미제출', rejected: '반려' }
  const c = map[status]

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {label[status]}
    </span>
  )
}

function StatCard({
  label, value, unit, icon, extra,
}: {
  label: string
  value: number
  unit: string
  icon: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <span className="bg-gray-100 text-gray-900 p-2 rounded-lg">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900 leading-none">
        {value.toLocaleString()}
        <span className="text-base font-medium text-gray-400 ml-1.5">{unit}</span>
      </p>
      {extra}
    </div>
  )
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-4 border-gray-900 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">대시보드 불러오는 중...</p>
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

function PdfSmallIcon() {
  return (
    <svg className="w-3 h-3 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

