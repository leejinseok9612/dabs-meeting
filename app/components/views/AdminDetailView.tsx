// ============================================================
// app/components/views/AdminDetailView.tsx
// DABs 관리자 실시간 모니터링 대시보드 — Attio/Linear 디자인
// ============================================================
'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient }   from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import PinGate            from '@/app/components/PinGate'
import MapAnnotator       from '@/app/components/MapAnnotator'
import type { WorkItemInfo } from '@/app/components/MapAnnotator'
import { toast }          from '@/app/components/Toast'

// ── 고정 업체 순서 ─────────────────────────────────────────────
const COMPANY_ORDER = ['천호엔지니어링', '참마루건설', '지디건설'] as const
type CompanyName = typeof COMPANY_ORDER[number]

function sortByCompanyOrder(submissions: SubmissionRow[]): SubmissionRow[] {
  return [...submissions].sort((a, b) => {
    const aIdx = COMPANY_ORDER.indexOf((a.teams?.name ?? '') as CompanyName)
    const bIdx = COMPANY_ORDER.indexOf((b.teams?.name ?? '') as CompanyName)
    return (aIdx === -1 ? COMPANY_ORDER.length : aIdx) - (bIdx === -1 ? COMPANY_ORDER.length : bIdx)
  })
}

// ── 타입 ──────────────────────────────────────────────────────
interface PersonnelDetail {
  elderly: number; superElderly: number; foreign: number; female: number; diseased: number
}
interface SubmissionRow {
  id: string; meeting_id: string; team_id: string
  status: 'pending' | 'submitted' | 'rejected'
  personnel_count?: number | null; personnel_detail?: PersonnelDetail | null
  equipment?: string | null; work_process?: string | null
  file_name?: string | null; submitted_at?: string | null
  admin_notes?: string | null
  reviewed_status?: 'approved' | 'revision_requested' | null
  reviewed_at?: string | null
  teams?: { id: string; name: string; department?: string | null }
}
interface Meeting { id: string; title: string; date: string; status: 'open' | 'closed' }
interface WorkItem {
  id: string; work_type: 'high_risk' | 'general'; team_id: string
  work_name: string; location?: string; worker_count: number; description?: string
  risk_factors?: string; improvement_measures?: string
  teams?: { id: string; name: string }
}
interface MaterialReservation {
  id: string; team_id: string; material_description?: string
  quantity?: string; vehicle_type?: string; teams?: { id: string; name: string }
}
interface MaterialSlot {
  id: string; slot_time: string; max_teams: number; gate: string
  material_reservations: MaterialReservation[]
}

// ── SELECT query ───────────────────────────────────────────────
const SUB_SELECT = 'id,meeting_id,team_id,status,personnel_count,personnel_detail,equipment,work_process,file_name,submitted_at,admin_notes,reviewed_status,reviewed_at,teams(id,name,department)'

// ── 메인 컴포넌트 ──────────────────────────────────────────────
export function AdminDetailView({
  meetingId, onBack, onMeetingMode,
}: {
  meetingId: string
  onBack: () => void
  onMeetingMode?: (meetingId: string) => void
}) {
  const supabase  = useMemo(() => createClient(), [])
  const channelRef = useRef<RealtimeChannel | null>(null)

  const [pinVerified,  setPinVerified]  = useState(false)
  const [meeting,      setMeeting]      = useState<Meeting | null>(null)
  const [submissions,  setSubmissions]  = useState<SubmissionRow[]>([])
  const [pageLoading,  setPageLoading]  = useState(true)
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)
  const [mapUrl,       setMapUrl]       = useState<string | null>(null)
  const [mapName,      setMapName]      = useState<string | null>(null)
  const [mapUploading, setMapUploading] = useState(false)
  const [mapError,     setMapError]     = useState<string | null>(null)
  const [openMapSection,  setOpenMapSection]  = useState<'high_risk' | 'general' | null>(null)
  const [openWorkSection, setOpenWorkSection] = useState<'high_risk' | 'general' | 'material' | null>(null)
  const [hoveredTeamId,   setHoveredTeamId]   = useState<string | null>(null)
  const [allTeams,     setAllTeams]     = useState<{id:string;name:string}[]>([])
  const [workItems,    setWorkItems]    = useState<WorkItem[]>([])
  const [slots,        setSlots]        = useState<MaterialSlot[]>([])
  const mapInputRef = useRef<HTMLInputElement>(null)

  const loadWorkItems = useCallback(() => {
    fetch(`/api/work-items?meetingId=${meetingId}`)
      .then(r => r.json()).then(d => Array.isArray(d) && setWorkItems(d)).catch(() => {})
  }, [meetingId])

  const loadSlots = useCallback(() => {
    fetch(`/api/material-slots?meetingId=${meetingId}`)
      .then(r => r.json()).then(d => Array.isArray(d) && setSlots(d)).catch(() => {})
  }, [meetingId])

  // ── 통계 ──────────────────────────────────────────────────
  const submitted      = submissions.filter(s => s.status === 'submitted')
  const totalPersonnel = submitted.reduce((sum, s) => sum + (s.personnel_count ?? 0), 0)
  const submittedCount = submitted.length
  const totalCompanies = COMPANY_ORDER.length
  const progressPct    = totalCompanies > 0 ? Math.round((submittedCount / totalCompanies) * 100) : 0

  // ── 초기 데이터 로드 ─────────────────────────────────────
  const loadData = useCallback(async () => {
    const [{ data: mtg }, { data: subs }] = await Promise.all([
      supabase.from('meetings').select('id,title,date,status,map_file_url,map_file_name').eq('id', meetingId).single(),
      supabase.from('submissions').select(SUB_SELECT).eq('meeting_id', meetingId),
    ])
    if (!mtg) { onBack(); return }
    setMeeting(mtg as unknown as Meeting)
    const mtgAny = mtg as unknown as { map_file_url?: string; map_file_name?: string }
    let mapFileUrl  = mtgAny.map_file_url  ?? null
    let mapFileName = mtgAny.map_file_name ?? null
    if (!mapFileUrl) {
      const { data: latest } = await supabase.from('meetings')
        .select('map_file_url,map_file_name').neq('id', meetingId).not('map_file_url', 'is', null)
        .order('date', { ascending: false }).limit(1).single()
      if (latest?.map_file_url) {
        mapFileUrl  = (latest as any).map_file_url
        mapFileName = (latest as any).map_file_name ?? null
        await supabase.from('meetings').update({ map_file_url: mapFileUrl, map_file_name: mapFileName }).eq('id', meetingId)
      }
    }
    setMapUrl(mapFileUrl); setMapName(mapFileName)
    setSubmissions((subs ?? []) as unknown as SubmissionRow[])
    setLastUpdated(new Date()); setPageLoading(false)
  }, [meetingId, supabase])

  useEffect(() => {
    if (pinVerified) {
      loadData(); loadWorkItems(); loadSlots()
      fetch('/api/teams').then(r => r.json()).then(d => Array.isArray(d) && setAllTeams(d)).catch(() => {})
    }
  }, [loadData, loadWorkItems, loadSlots, pinVerified])

  // ── Realtime ───────────────────────────────────────────────
  useEffect(() => {
    if (!meetingId) return
    const channel = supabase.channel(`dashboard:${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `meeting_id=eq.${meetingId}` },
        async (payload) => {
          const changedId = (payload.new as SubmissionRow)?.id ?? (payload.old as SubmissionRow)?.id
          if (!changedId) return
          if (payload.eventType === 'DELETE') { setSubmissions(prev => prev.filter(s => s.id !== changedId)); setLastUpdated(new Date()); return }
          const { data: fresh } = await supabase.from('submissions').select(SUB_SELECT).eq('id', changedId).single()
          if (!fresh) return
          setSubmissions(prev => {
            const exists = prev.find(s => s.id === (fresh as unknown as SubmissionRow).id)
            return exists
              ? prev.map(s => s.id === (fresh as any).id ? fresh as unknown as SubmissionRow : s)
              : [...prev, fresh as unknown as SubmissionRow]
          })
          setLastUpdated(new Date())
        })
      .subscribe()
    channelRef.current = channel
    return () => { channel.unsubscribe() }
  }, [meetingId, supabase])

  useEffect(() => {
    if (!meetingId) return
    const ch = supabase.channel(`admin_work:${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items', filter: `meeting_id=eq.${meetingId}` }, () => loadWorkItems())
      .subscribe()
    return () => { ch.unsubscribe() }
  }, [meetingId, supabase, loadWorkItems])

  useEffect(() => {
    if (!meetingId) return
    const ch = supabase.channel(`admin_material:${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_reservations' }, () => loadSlots())
      .subscribe()
    return () => { ch.unsubscribe() }
  }, [meetingId, supabase, loadSlots])

  // ── 지적도 업로드 ─────────────────────────────────────────
  // ── 관리자 작업항목 수정/삭제 (지적도 마커 동기화 포함) ──
  async function deleteWorkItem(id: string) {
    const item = workItems.find(w => w.id === id)
    // 작업항목 삭제
    await fetch(`/api/work-items?id=${id}`, { method: 'DELETE' })
    // 연결된 지적도 마커도 삭제
    if (item) {
      await fetch(
        `/api/map-markers?meetingId=${meetingId}&teamId=${item.team_id}&label=${encodeURIComponent(item.work_name)}&workType=${item.work_type}`,
        { method: 'DELETE' }
      )
    }
    loadWorkItems()
  }

  async function updateWorkItem(id: string, updates: { work_name?: string; location?: string; worker_count?: number; description?: string; risk_factors?: string; improvement_measures?: string }) {
    const item = workItems.find(w => w.id === id)
    // 작업항목 수정
    await fetch('/api/work-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    // 작업명이 바뀌면 연결된 지적도 마커 라벨도 동기화
    if (item && updates.work_name && updates.work_name !== item.work_name) {
      await fetch('/api/map-markers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId,
          teamId:   item.team_id,
          oldLabel: item.work_name,
          newLabel: updates.work_name,
          workType: item.work_type,
        }),
      })
    }
    loadWorkItems()
  }

  async function deleteReservation(reservationId: string) {
    await fetch(`/api/material-slots?reservationId=${reservationId}`, { method: 'DELETE' })
    loadSlots()
  }

  async function handleMapUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !meeting) return
    setMapUploading(true); setMapError(null)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('meetingId', meeting.id)
      const res = await fetch('/api/upload-map', { method: 'POST', body: fd })
      if (res.ok) { const { url, name } = await res.json(); setMapUrl(url); setMapName(name) }
      else { const err = await res.json().catch(() => ({})); setMapError(err.error ?? '업로드에 실패했습니다.') }
    } catch { setMapError('네트워크 오류가 발생했습니다.') }
    setMapUploading(false)
  }

  if (!pinVerified) return <PinGate onSuccess={() => setPinVerified(true)} />
  if (pageLoading)  return <PageLoader />

  const sorted = sortByCompanyOrder(submissions)

  return (
    <div className="min-h-screen bg-neutral-50">

      {/* ── 헤더 ───────────────────────────────────────────── */}
      <header className="bg-white/90 backdrop-blur-sm sticky top-0 z-20"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="max-w-5xl mx-auto px-5 h-13 flex items-center justify-between gap-4"
          style={{ height: '3.25rem' }}>
          <div className="flex items-center gap-3">
            <button onClick={() => onBack()}
              className="btn btn-ghost btn-sm gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              회의 목록
            </button>
            <div className="w-px h-4 bg-neutral-200" />
            <div>
              <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-widest mb-0.5">DABs Admin</p>
              <h1 className="text-sm font-semibold text-neutral-900 leading-none tracking-tight">
                {meeting?.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-pulse" />
              <span className="text-xs text-neutral-400 font-medium">실시간</span>
            </div>
            {lastUpdated && (
              <span className="text-[11px] text-neutral-400 tabular-nums">
                {lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <span className={[
              'badge',
              meeting?.status === 'open'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60'
                : 'bg-neutral-100 text-neutral-500',
            ].join(' ')}>
              <span className={[
                'w-1.5 h-1.5 rounded-full',
                meeting?.status === 'open' ? 'bg-emerald-400 animate-live-pulse' : 'bg-neutral-400',
              ].join(' ')} />
              {meeting?.status === 'open' ? '접수중' : '마감'}
            </span>
            {onMeetingMode && (
              <button
                onClick={() => onMeetingMode(meetingId)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-neutral-900 text-white hover:bg-neutral-700 active:scale-[0.98] transition-all duration-150"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.5 2.625c.621 0 1.125.504 1.125 1.125v1.5m-7.5-6h6.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125H7.5a1.125 1.125 0 01-1.125-1.125V7.5c0-.621.504-1.125 1.125-1.125h.75" />
                </svg>
                회의 모드
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6 space-y-4">

        {/* ── 통계 카드 3종 ──────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="총 투입 인원" value={totalPersonnel} unit="명"
            icon={<PeopleIcon />} color="neutral" />
          <StatCard label="제출 완료" value={submittedCount} unit={`/ ${totalCompanies}`}
            icon={<CheckIcon />} color="emerald" />
          <StatCard label="제출 진행률" value={progressPct} unit="%"
            icon={<ChartIcon />} color="neutral"
            extra={
              <div className="mt-2.5 h-1 bg-neutral-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-neutral-900 transition-all duration-700"
                  style={{ width: `${progressPct}%` }} />
              </div>
            }
          />
        </div>

        {/* ── 지적도/공사현황도 업로드 ────────────────────── */}
        <section className="surface p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 tracking-tight">지적도 / 공사현황도</h2>
              <p className="text-xs text-neutral-400 mt-0.5">업체들이 고위험·일반 지적도에 마커를 표시합니다</p>
            </div>
            <div className="flex items-center gap-2">
              {mapUploading && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <span className="w-3.5 h-3.5 border-2 border-neutral-300 border-t-neutral-700 rounded-full"
                    style={{ animation: 'spin 0.8s linear infinite' }} />
                  업로드 중
                </div>
              )}
              <input ref={mapInputRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={handleMapUpload} />
              <button onClick={() => mapInputRef.current?.click()} disabled={mapUploading}
                className="btn btn-secondary btn-sm">
                {mapUrl ? '이미지 교체' : '파일 첨부'}
              </button>
            </div>
          </div>

          {mapError && (
            <div className="mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-600">
              {mapError}
            </div>
          )}

          {mapUrl ? (
            <div className="flex items-center gap-3 bg-neutral-50 rounded-lg px-3.5 py-2.5"
              style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
              <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <p className="text-xs font-medium text-neutral-700 flex-1 truncate">{mapName}</p>
              <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-neutral-500 hover:text-neutral-900 transition-colors underline underline-offset-2">
                원본보기
              </a>
            </div>
          ) : (
            <div className="rounded-lg py-6 text-center" style={{ border: '2px dashed rgba(0,0,0,0.08)' }}>
              <p className="text-xs text-neutral-400">JPG, PNG 이미지 파일을 업로드하세요</p>
            </div>
          )}
        </section>

        {/* ── 고위험 지적도 아코디언 ──────────────────────── */}
        {mapUrl && (
          <section className="surface overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 transition-colors duration-150 hover:bg-neutral-50/80"
              onClick={() => setOpenMapSection(prev => prev === 'high_risk' ? null : 'high_risk')}
            >
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <div className="text-left">
                  <h2 className="text-sm font-semibold text-neutral-900 tracking-tight">고위험 지적도</h2>
                  <p className="text-[11px] text-neutral-400 mt-0.5">고위험 작업 마커 현황</p>
                </div>
              </div>
              <svg className={['w-4 h-4 text-neutral-400 transition-transform duration-150', openMapSection === 'high_risk' ? 'rotate-180' : ''].join(' ')}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openMapSection === 'high_risk' && (
              <div className="border-t border-neutral-100 p-4 animate-accordion-down">
                <MapAnnotator meetingId={meetingId} mapUrl={mapUrl} myTeamId=""
                  allTeamIds={allTeams.map(t => t.id)} readOnly={true} workType="high_risk"
                  workItems={workItems as unknown as WorkItemInfo[]}
                  hoveredTeamId={hoveredTeamId} />
              </div>
            )}
          </section>
        )}


        {/* ── 작업 현황 / 자재 하역 (아코디언) ─────────────── */}
        {([
          { key: 'high_risk' as const, label: '고위험 작업 현황',  dot: 'bg-red-400',
            count: workItems.filter(w => w.work_type === 'high_risk').length },
          { key: 'general'   as const, label: '일반 작업 현황',    dot: 'bg-blue-400',
            count: workItems.filter(w => w.work_type === 'general').length },
          { key: 'material'  as const, label: '자재 하역/운반',     dot: 'bg-amber-400',
            count: slots.reduce((acc, s) => acc + (s.material_reservations?.length ?? 0), 0) },
        ]).map(({ key, label, dot, count }) => {
          const open = openWorkSection === key
          return (
            <section key={key} className="surface overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3.5 transition-colors duration-150 hover:bg-neutral-50/80"
                onClick={() => setOpenWorkSection(prev => prev === key ? null : key)}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-neutral-900 tracking-tight">{label}</h2>
                    <span className={[
                      'badge text-[10px]',
                      count > 0 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500',
                    ].join(' ')}>
                      {count}건
                    </span>
                  </div>
                </div>
                <svg className={['w-4 h-4 text-neutral-400 transition-transform duration-150', open ? 'rotate-180' : ''].join(' ')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {open && (
                <div className="border-t border-neutral-100 animate-accordion-down">
                  {key === 'high_risk' && <WorkItemSection items={workItems.filter(w => w.work_type === 'high_risk')} color="red" onDelete={deleteWorkItem} onEdit={updateWorkItem} onHoverTeam={setHoveredTeamId} />}
                  {key === 'general'   && <WorkItemSection items={workItems.filter(w => w.work_type === 'general')} color="blue" onDelete={deleteWorkItem} onEdit={updateWorkItem} onHoverTeam={setHoveredTeamId} />}
                  {key === 'material'  && <MaterialSection slots={slots} onDeleteReservation={deleteReservation} />}
                </div>
              )}
            </section>
          )
        })}

        {/* ── 제출 현황 테이블 ─────────────────────────────── */}
        <SubmissionsSection sorted={sorted} meeting={meeting} />

      </main>
    </div>
  )
}

// ── 서브 컴포넌트 ──────────────────────────────────────────────

// ── 고위험/일반 작업 현황 ────────────────────────────────────────
function WorkItemSection({
  items, color, onDelete, onEdit, onHoverTeam,
}: {
  items: WorkItem[]
  color: 'red' | 'blue'
  onDelete: (id: string) => Promise<void>
  onEdit: (id: string, updates: { work_name?: string; location?: string; worker_count?: number; description?: string; risk_factors?: string; improvement_measures?: string }) => Promise<void>
  onHoverTeam?: (teamId: string | null) => void
}) {
  const [filterTeam,    setFilterTeam]    = useState<string | null>(null)
  const [editItem,      setEditItem]      = useState<WorkItem | null>(null)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  // 편집 폼 상태
  const [editName,      setEditName]      = useState('')
  const [editLoc,       setEditLoc]       = useState('')
  const [editCount,     setEditCount]     = useState(0)
  const [editDesc,      setEditDesc]      = useState('')
  const [editRisk,      setEditRisk]      = useState('')
  const [editImprove,   setEditImprove]   = useState('')

  const teams   = [...new Map(items.filter(i => i.teams?.name).map(i => [i.teams!.name, i.teams!])).values()]
  const filtered = filterTeam ? items.filter(i => i.teams?.name === filterTeam) : items

  function openEdit(item: WorkItem) {
    setEditItem(item)
    setEditName(item.work_name)
    setEditLoc(item.location ?? '')
    setEditCount(item.worker_count)
    setEditDesc(item.description ?? '')
    setEditRisk(item.risk_factors ?? '')
    setEditImprove(item.improvement_measures ?? '')
  }

  async function handleSave() {
    if (!editItem) return
    setSaving(true)
    await onEdit(editItem.id, {
      work_name: editName, location: editLoc, worker_count: editCount,
      description: editDesc, risk_factors: editRisk, improvement_measures: editImprove,
    })
    toast.success('작업항목이 수정됐습니다.')
    setSaving(false)
    setEditItem(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('이 작업항목을 삭제하시겠습니까?')) return
    setDeleting(id)
    await onDelete(id)
    setDeleting(null)
  }

  if (items.length === 0) {
    return <div className="px-5 py-8 text-center text-xs text-neutral-400">등록된 작업이 없습니다.</div>
  }
  return (
    <div>
      {teams.length > 1 && (
        <div className="px-5 py-2.5 border-b border-neutral-100 flex flex-wrap gap-1.5 bg-neutral-50/60">
          <button onClick={() => setFilterTeam(null)}
            className={['btn btn-sm', filterTeam === null ? 'btn-primary' : 'btn-secondary'].join(' ')}>
            전체 ({items.length})
          </button>
          {teams.map(t => (
            <button key={t.id} onClick={() => setFilterTeam(prev => prev === t.name ? null : t.name)}
              className={['btn btn-sm', filterTeam === t.name ? 'btn-primary' : 'btn-secondary'].join(' ')}>
              {t.name} ({items.filter(i => i.teams?.name === t.name).length})
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-neutral-50/80 border-b border-neutral-100">
              <th className="text-left px-5 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">업체명</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">작업명</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">위치</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">인원</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">내용</th>
              <th className="px-3 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}
                className="border-b border-neutral-100/70 transition-colors duration-100 hover:bg-neutral-50/80 cursor-default"
                onMouseEnter={() => onHoverTeam?.(item.team_id)}
                onMouseLeave={() => onHoverTeam?.(null)}
              >
                <td className="px-5 py-2.5 font-medium text-neutral-800 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className={['w-1.5 h-1.5 rounded-full shrink-0', color === 'red' ? 'bg-red-400' : 'bg-blue-400'].join(' ')} />
                    {item.teams?.name ?? '—'}
                  </div>
                </td>
                <td className="px-4 py-2.5 font-medium text-neutral-700">{item.work_name}</td>
                <td className="px-4 py-2.5 text-neutral-500">{item.location || '—'}</td>
                <td className="px-4 py-2.5 text-neutral-500 whitespace-nowrap">{item.worker_count > 0 ? `${item.worker_count}명` : '—'}</td>
                <td className="px-4 py-2.5 text-neutral-400 max-w-[200px] truncate">{item.description || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1 justify-center">
                    <button onClick={() => openEdit(item)}
                      title="수정"
                      className="p-1.5 rounded hover:bg-blue-50 text-neutral-400 hover:text-blue-600 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                      title="삭제"
                      className="p-1.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-40">
                      {deleting === item.id
                        ? <span className="w-3.5 h-3.5 block border-2 border-neutral-300 border-t-red-400 rounded-full animate-spin" />
                        : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                      }
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-neutral-400">해당 업체의 작업이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 작업항목 편집 모달 ── */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4"
          onClick={e => { if (e.target === e.currentTarget) setEditItem(null) }}>
          <div className="bg-white rounded-xl border border-neutral-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">작업항목 수정</h3>
              <button onClick={() => setEditItem(null)} className="text-neutral-400 hover:text-neutral-700 p-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-neutral-500">업체: <span className="font-medium text-neutral-700">{editItem.teams?.name}</span></p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">작업명 *</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">위치</label>
                <input value={editLoc} onChange={e => setEditLoc(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">투입 인원 (명)</label>
                <input type="number" min={0} value={editCount} onChange={e => setEditCount(Number(e.target.value))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">내용/비고</label>
                <textarea rows={2} value={editDesc} onChange={e => setEditDesc(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  ⚠ 위험요인
                </label>
                <textarea rows={2} value={editRisk} onChange={e => setEditRisk(e.target.value)}
                  placeholder="예) 굴착 작업 중 지반 붕괴 위험"
                  className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 resize-none bg-amber-50/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  ✅ 개선대책
                </label>
                <textarea rows={2} value={editImprove} onChange={e => setEditImprove(e.target.value)}
                  placeholder="예) 흙막이 설치 및 안전망 설치 확인"
                  className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 resize-none bg-emerald-50/30" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditItem(null)}
                className="flex-1 py-2.5 rounded-lg border border-neutral-200 text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors">
                취소
              </button>
              <button onClick={handleSave} disabled={saving || !editName.trim()}
                className="flex-1 py-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 자재 하역/운반 현황 (ALL + GATE 탭 필터) ───────────────────
function MaterialSection({ slots, onDeleteReservation }: {
  slots: MaterialSlot[]
  onDeleteReservation: (id: string) => Promise<void>
}) {
  const gates   = [...new Set(slots.map(s => s.gate))].sort()
  const ALL_KEY = '__ALL__'
  const [activeGate, setActiveGate] = useState<string>(ALL_KEY)
  const [deleting,   setDeleting]   = useState<string | null>(null)

  // ALL이면 전체, 아니면 해당 GATE만
  const visibleSlots = activeGate === ALL_KEY
    ? slots
    : slots.filter(s => s.gate === activeGate)

  const rows = visibleSlots.flatMap(slot =>
    (slot.material_reservations ?? []).map(r => ({ slot, r }))
  )

  const totalCount = slots.reduce((a, s) => a + (s.material_reservations?.length ?? 0), 0)

  async function handleDelete(id: string) {
    if (!confirm('이 예약을 삭제하시겠습니까?')) return
    setDeleting(id)
    await onDeleteReservation(id)
    setDeleting(null)
  }

  if (slots.length === 0) {
    return <div className="px-5 py-8 text-center text-xs text-neutral-400">예약된 자재 하역이 없습니다.</div>
  }

  return (
    <div>
      {/* ── GATE 탭 — ALL 기본 ─────────────────────────── */}
      <div className="flex border-b border-neutral-100 overflow-x-auto">
        {/* ALL 탭 */}
        <button
          onClick={() => setActiveGate(ALL_KEY)}
          className={[
            'flex items-center gap-1.5 px-5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-all duration-150 whitespace-nowrap',
            activeGate === ALL_KEY
              ? 'border-neutral-900 text-neutral-900'
              : 'border-transparent text-neutral-400 hover:text-neutral-600',
          ].join(' ')}>
          전체
          <span className={['badge text-[9px] px-1.5', activeGate === ALL_KEY ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'].join(' ')}>
            {totalCount}
          </span>
        </button>
        {/* 개별 GATE 탭 */}
        {gates.map(gate => {
          const cnt = slots.filter(s => s.gate === gate).reduce((a, s) => a + (s.material_reservations?.length ?? 0), 0)
          return (
            <button key={gate} onClick={() => setActiveGate(gate)}
              className={[
                'flex items-center gap-1.5 px-5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-all duration-150 whitespace-nowrap',
                activeGate === gate
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-400 hover:text-neutral-600',
              ].join(' ')}>
              {gate}
              {cnt > 0 && (
                <span className={['badge text-[9px] px-1.5', activeGate === gate ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'].join(' ')}>
                  {cnt}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── 테이블 ─────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-neutral-400">
          {activeGate === ALL_KEY ? '예약된 자재 하역이 없습니다.' : `${activeGate}에 예약된 자재 하역이 없습니다.`}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-neutral-50/80 border-b border-neutral-100">
                {(activeGate === ALL_KEY ? ['GATE','시간대','업체명','자재 내용','수량/규격','차량 종류','관리']
                                         : ['시간대','업체명','자재 내용','수량/규격','차량 종류','관리']
                ).map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ slot, r }) => (
                <tr key={r.id} className="border-b border-neutral-100/70 transition-colors duration-100 hover:bg-neutral-50/80">
                  {activeGate === ALL_KEY && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="badge bg-neutral-100 text-neutral-600 text-[10px]">{slot.gate}</span>
                    </td>
                  )}
                  <td className="px-4 py-2.5 font-medium text-neutral-700 whitespace-nowrap">{slot.slot_time}</td>
                  <td className="px-4 py-2.5 font-medium text-neutral-700 whitespace-nowrap">{r.teams?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-neutral-600">{r.material_description || '—'}</td>
                  <td className="px-4 py-2.5 text-neutral-500 whitespace-nowrap">{r.quantity || '—'}</td>
                  <td className="px-4 py-2.5">
                    {r.vehicle_type
                      ? <span className="badge bg-neutral-100 text-neutral-600">{r.vehicle_type}</span>
                      : <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                      title="예약 삭제"
                      className="p-1.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-40">
                      {deleting === r.id
                        ? <span className="w-3.5 h-3.5 block border-2 border-neutral-300 border-t-red-400 rounded-full animate-spin" />
                        : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 제출 현황 테이블 (검색 + 상태필터 + CSV + 검토 모달) ──────────
function SubmissionsSection({ sorted, meeting }: { sorted: SubmissionRow[]; meeting: Meeting | null }) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'pending'>('all')
  const [searchQuery,  setSearchQuery]  = useState('')
  const [modalRow,     setModalRow]     = useState<SubmissionRow | null>(null)

  const filtered = sorted
    .filter(s => statusFilter === 'all' || s.status === statusFilter)
    .filter(s => !searchQuery.trim() || (s.teams?.name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase()))

  const submittedCount = sorted.filter(s => s.status === 'submitted').length
  const pendingCount   = sorted.filter(s => s.status === 'pending').length

  function exportCSV() {
    const headers = ['순번','업체명','부서','제출상태','총인원','고령자','초고령자','외국인','여성','유질환','작업공정','투입장비','제출파일','제출시간','검토상태','관리자메모']
    const rows = sorted.map((s, i) => [
      String(i + 1), s.teams?.name ?? '', s.teams?.department ?? '',
      s.status === 'submitted' ? '제출완료' : s.status === 'rejected' ? '반려' : '미제출',
      String(s.personnel_count ?? ''),
      String(s.personnel_detail?.elderly ?? ''), String(s.personnel_detail?.superElderly ?? ''),
      String(s.personnel_detail?.foreign ?? ''), String(s.personnel_detail?.female ?? ''),
      String(s.personnel_detail?.diseased ?? ''),
      s.work_process ?? '', s.equipment ?? '', s.file_name ?? '',
      s.submitted_at ? new Date(s.submitted_at).toLocaleString('ko-KR') : '',
      s.reviewed_status === 'approved' ? '검토완료' : s.reviewed_status === 'revision_requested' ? '보완요청' : '',
      s.admin_notes ?? '',
    ])
    const csv  = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `DABs_제출현황_${meeting?.date ?? new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('CSV 파일이 다운로드됩니다.')
  }

  return (
    <>
      <section className="surface overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-100 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-neutral-900 tracking-tight">업체별 제출 현황</h2>
            <button onClick={exportCSV} className="btn btn-secondary btn-sm gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              CSV 내보내기
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] max-w-56">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input type="text" placeholder="업체명 검색…" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="input pl-8" />
            </div>
            <div className="flex gap-1">
              {([
                { key: 'all',       label: `전체 ${sorted.length}` },
                { key: 'submitted', label: `제출완료 ${submittedCount}` },
                { key: 'pending',   label: `미제출 ${pendingCount}` },
              ] as const).map(f => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={['btn btn-sm', statusFilter === f.key ? 'btn-primary' : 'btn-secondary'].join(' ')}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-neutral-50/80 border-b border-neutral-100">
                {['#','업체명','투입 인원','작업공정','투입 장비','제출 파일','제출 시간','상태','검토'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((sub, idx) => (
                <SubmissionRowItem key={sub.id} row={sub} index={idx + 1} onReview={() => setModalRow(sub)} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-xs text-neutral-400">
                    {searchQuery ? `"${searchQuery}"에 해당하는 업체가 없습니다.`
                      : statusFilter === 'all' ? '아직 제출된 자료가 없습니다.' : '해당 조건의 업체가 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalRow && (
        <ReviewModal row={modalRow} onClose={() => setModalRow(null)}
          onSaved={() => setModalRow(null)} />
      )}
    </>
  )
}

// ── 검토 모달 ───────────────────────────────────────────────────
function ReviewModal({ row, onClose, onSaved }: {
  row: SubmissionRow; onClose: () => void; onSaved: (updated: SubmissionRow) => void
}) {
  const [reviewedStatus, setReviewedStatus] = useState<'approved' | 'revision_requested' | ''>(row.reviewed_status ?? '')
  const [adminNotes, setAdminNotes] = useState(row.admin_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/admin-submission', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: row.id, reviewedStatus: reviewedStatus || null, adminNotes: adminNotes.trim() || null }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? '저장 실패') }
      onSaved({ ...row, reviewed_status: reviewedStatus || null, admin_notes: adminNotes.trim() || null })
    } catch (e) { setError(e instanceof Error ? e.message : '오류가 발생했습니다.') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full max-w-md rounded-xl overflow-hidden animate-slide-up-fade"
        style={{ boxShadow: 'var(--shadow-modal)' }}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight">검토 메모</h3>
            <p className="text-xs text-neutral-400 mt-0.5">{row.teams?.name ?? '업체명 없음'}</p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm w-7 h-7 p-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">검토 상태</label>
            <div className="flex gap-1.5">
              {([
                { key: 'approved',           label: '검토완료', activeClass: 'bg-emerald-600 text-white border-emerald-600' },
                { key: 'revision_requested', label: '보완요청', activeClass: 'bg-amber-500 text-white border-amber-500'   },
                { key: '',                   label: '미검토',   activeClass: 'bg-neutral-900 text-white border-neutral-900' },
              ] as const).map(opt => (
                <button key={opt.key} type="button" onClick={() => setReviewedStatus(opt.key)}
                  className={[
                    'btn flex-1',
                    reviewedStatus === opt.key ? opt.activeClass : 'btn-secondary',
                  ].join(' ')}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">관리자 메모</label>
            <textarea rows={4} value={adminNotes} onChange={e => setAdminNotes(e.target.value)}
              placeholder="업체에 전달할 검토 의견이나 보완 사항…"
              className="input w-full"
              style={{ height: 'auto', padding: '0.5rem 0.625rem' }} />
          </div>
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3.5 border-t border-neutral-100 flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-ghost">취소</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"
                  style={{ animation: 'spin 0.8s linear infinite' }} />
                저장 중
              </span>
            ) : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 제출 행 ─────────────────────────────────────────────────────
function SubmissionRowItem({ row, index, onReview }: { row: SubmissionRow; index: number; onReview: () => void }) {
  const isSubmitted = row.status === 'submitted'
  return (
    <tr className={['border-b border-neutral-100/70 transition-colors duration-100 hover:bg-neutral-50/80', !isSubmitted ? 'opacity-60' : ''].join(' ')}>
      <td className="pl-5 pr-4 py-2.5 text-neutral-400 text-[11px] tabular-nums">{index}</td>
      <td className="px-4 py-2.5">
        <p className="font-medium text-neutral-800 text-xs">{row.teams?.name ?? '—'}</p>
        {row.teams?.department && <p className="text-[10px] text-neutral-400">{row.teams.department}</p>}
        {row.admin_notes && (
          <p className="text-[10px] text-amber-600 mt-0.5 max-w-[120px] truncate" title={row.admin_notes}>
            {row.admin_notes}
          </p>
        )}
      </td>
      <td className="px-4 py-2.5 min-w-[100px]">
        {isSubmitted && row.personnel_count != null ? (
          <div>
            <span className="text-sm font-bold text-neutral-900 tabular-nums">{row.personnel_count}</span>
            <span className="text-[10px] text-neutral-400 ml-0.5">명</span>
            {row.personnel_detail && (
              <div className="mt-1 space-y-0.5">
                {([
                  { key: 'elderly', label: '고령' }, { key: 'superElderly', label: '초고령' },
                  { key: 'foreign', label: '외국인' }, { key: 'female', label: '여성' }, { key: 'diseased', label: '유질환' },
                ] as const).filter(item => (row.personnel_detail![item.key] ?? 0) > 0).map(item => (
                  <div key={item.key} className="flex items-center gap-1">
                    <span className="text-[9px] text-neutral-400 w-10 shrink-0">{item.label}</span>
                    <span className="text-[9px] text-neutral-400">{row.personnel_detail![item.key]}명</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : <span className="text-neutral-300">—</span>}
      </td>
      <td className="px-4 py-2.5 text-neutral-500 text-[11px] max-w-[120px] truncate">{row.work_process || <span className="text-neutral-300">—</span>}</td>
      <td className="px-4 py-2.5 text-neutral-500 text-[11px] max-w-[140px]">
        {row.equipment ? row.equipment.split(',').map((e, i) => <span key={i} className="block leading-4">{e.trim()}</span>) : <span className="text-neutral-300">—</span>}
      </td>
      <td className="px-4 py-2.5 text-[11px] text-neutral-400 max-w-[120px] truncate" title={row.file_name ?? ''}>
        {row.file_name
          ? <span className="flex items-center gap-1"><PdfSmallIcon /><span className="truncate">{row.file_name}</span></span>
          : <span className="text-neutral-300">—</span>}
      </td>
      <td className="px-4 py-2.5 text-[11px] text-neutral-400 whitespace-nowrap tabular-nums">
        {row.submitted_at
          ? new Date(row.submitted_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : <span className="text-neutral-300">—</span>}
      </td>
      <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-1 items-start">
          {row.reviewed_status && <ReviewedBadge status={row.reviewed_status} />}
          <button onClick={onReview}
            className="text-[10px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 transition-colors duration-100">
            {row.reviewed_status ? '수정' : '검토'}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── 배지 컴포넌트 ────────────────────────────────────────────────
function StatusBadge({ status }: { status: SubmissionRow['status'] }) {
  const cfg = {
    submitted: { cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70', dot: 'bg-emerald-400', label: '제출완료' },
    pending:   { cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70',   dot: 'bg-amber-400',   label: '미제출'  },
    rejected:  { cls: 'bg-red-50 text-red-600 ring-1 ring-red-200/60',         dot: 'bg-red-400',     label: '반려'    },
  }[status]
  return (
    <span className={`badge ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function ReviewedBadge({ status }: { status: 'approved' | 'revision_requested' }) {
  if (status === 'approved') {
    return (
      <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        검토완료
      </span>
    )
  }
  return (
    <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200/60">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      보완요청
    </span>
  )
}

// ── StatCard ─────────────────────────────────────────────────────
function StatCard({ label, value, unit, icon, color, extra }: {
  label: string; value: number; unit: string; icon: React.ReactNode
  color: 'neutral' | 'emerald'; extra?: React.ReactNode
}) {
  const iconBg = color === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-600'
  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between mb-2.5">
        <p className="text-xs font-medium text-neutral-500 tracking-tight">{label}</p>
        <span className={`p-1.5 rounded-lg ${iconBg}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-neutral-900 tracking-tight leading-none">
        {value.toLocaleString()}
        <span className="text-sm font-medium text-neutral-400 ml-1.5">{unit}</span>
      </p>
      {extra}
    </div>
  )
}

// ── PageLoader (Skeleton UI) ─────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* 헤더 skeleton */}
      <div className="bg-white/90 backdrop-blur-sm sticky top-0 z-20" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="max-w-5xl mx-auto px-5 flex items-center gap-4" style={{ height: '3.25rem' }}>
          <div className="skeleton h-4 w-20" />
          <div className="w-px h-4 bg-neutral-100" />
          <div className="skeleton h-3.5 w-36" />
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-5 py-6 space-y-4">
        {/* StatCard skeleton */}
        <div className="grid grid-cols-3 gap-3">
          {[0,1,2].map(i => (
            <div key={i} className="surface p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="skeleton h-3 w-20" />
                <div className="skeleton h-7 w-7 rounded-lg" />
              </div>
              <div className="skeleton h-7 w-24" />
            </div>
          ))}
        </div>
        {/* 섹션 카드 skeleton */}
        {[130, 50, 50, 50].map((h, i) => (
          <div key={i} className="surface p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="skeleton h-4 w-28" />
              <div className="skeleton h-7 w-20 rounded-md" />
            </div>
            <div className="skeleton rounded-lg" style={{ height: h }} />
          </div>
        ))}
        {/* 테이블 skeleton */}
        <div className="surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-7 w-24 rounded-md" />
          </div>
          <table className="w-full">
            <tbody>
              {[0,1,2].map(i => (
                <tr key={i} className="border-b border-neutral-100/70">
                  {[40,90,60,80,80,80,70,60,60].map((w, j) => (
                    <td key={j} className="px-4 py-[11px]">
                      <div className="skeleton h-3.5 rounded" style={{ width: w }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Icons (strokeWidth={1.5}, size 16) ───────────────────────────
function PeopleIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function ChartIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}
function PdfSmallIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}


