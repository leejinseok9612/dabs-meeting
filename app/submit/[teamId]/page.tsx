// ============================================================
// app/submit/[teamId]/page.tsx — DABs 협력업체 통합 제출 페이지 v3
// 레이아웃: 좌측 지적도(협업 지도) / 우측 탭 입력
// 실시간: 작업항목·자재슬롯 Supabase Realtime 구독
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MapAnnotator from '@/app/components/MapAnnotator'

// ── 타입 ────────────────────────────────────────────────────
interface Team    { id: string; name: string; department?: string }
interface Meeting { id: string; title: string; date: string; status: 'open' | 'closed'; map_file_url?: string }
interface Announcement { id: string; title: string; content: string }
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

type Tab       = 'submit' | 'high_risk' | 'general' | 'material'
type UploadStep = 'idle' | 'uploading' | 'saving' | 'done' | 'error'

// ── 상수 ────────────────────────────────────────────────────
const MAX_FILE_MB    = 50
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024

const EQUIPMENT_LIST = [
  '굴착기', '소형굴착기', '로더', '불도저', '모터그레이더',
  '덤프트럭', '콘크리트믹서트럭', '콘크리트펌프카',
  '이동식크레인', '천공기', '항타기', '압쇄기',
  '롤러', '지게차', '살수차', '집게차', '스크레이퍼', '기타',
]
const DIRECT_INPUT_VALUE = '__직접입력__'
const VEHICLE_LIST = ['덤프트럭', '트레일러', '카고트럭', '지게차', '크레인차', '탱크로리', '기타']

// ── 메인 컴포넌트 ─────────────────────────────────────────
export default function SubmissionPage() {
  const params   = useParams()
  const teamId   = params.teamId as string
  const supabase = useMemo(() => createClient(), [])

  // 공통
  const [team,      setTeam]      = useState<Team | null>(null)
  const [allTeams,  setAllTeams]  = useState<Team[]>([])
  const [meeting,   setMeeting]   = useState<Meeting | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [noMeeting, setNoMeeting] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('high_risk')

  // 공지사항
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [showPopup,     setShowPopup]     = useState(false)
  const [popupIdx,      setPopupIdx]      = useState(0)

  // 작업 항목 (실시간)
  const [workItems,   setWorkItems]   = useState<WorkItem[]>([])
  const [workLoading, setWorkLoading] = useState(false)

  // 자재 슬롯 (실시간)
  const [slots,        setSlots]        = useState<MaterialSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  // ── 자료제출 폼 상태 ─────────────────────────────────────
  const [personnel, setPersonnel] = useState({
    elderly: '', superElderly: '', foreign: '', female: '', diseased: '', total: '',
  })
  const [workProcess, setWorkProcess] = useState('')
  const [equipRows,   setEquipRows]   = useState<{type: string; count: string; isCustom: boolean}[]>([
    { type: '', count: '', isCustom: false },
  ])
  const [file,        setFile]        = useState<File | null>(null)
  const [dragOver,    setDragOver]    = useState(false)
  const [errors,      setErrors]      = useState<Record<string, string>>({})
  const [step,        setStep]        = useState<UploadStep>('idle')
  const [progress,    setProgress]    = useState(0)
  const [errorMsg,    setErrorMsg]    = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [prevLoading, setPrevLoading] = useState(false)
  const [prevDate,    setPrevDate]    = useState<string | null>(null)
  const [prevLoaded,  setPrevLoaded]  = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 초기 데이터 로드 ──────────────────────────────────────
  useEffect(() => {
    async function load() {
      const res  = await fetch(`/api/submit-info?teamId=${teamId}`)
      if (res.status === 404) { setLoading(false); return }
      const data = await res.json()
      if (!data.team) { setLoading(false); return }
      setTeam(data.team)
      if (!data.meeting) setNoMeeting(true)
      else setMeeting(data.meeting)
      setLoading(false)
    }
    async function loadTeams() {
      try {
        const res  = await fetch('/api/teams')
        const data = await res.json()
        if (Array.isArray(data)) setAllTeams(data)
      } catch {}
    }
    load()
    loadTeams()
  }, [teamId])

  // 공지사항 로드 (로그인 후 팝업)
  useEffect(() => {
    fetch('/api/announcements?activeOnly=true')
      .then(r => r.json())
      .then((data: Announcement[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setAnnouncements(data)
          setShowPopup(true)
        }
      })
      .catch(() => {})
  }, [])

  // ── 작업항목 로드 + 실시간 구독 ──────────────────────────
  const reloadWorkItems = useCallback((meetingId: string) => {
    fetch(`/api/work-items?meetingId=${meetingId}`)
      .then(r => r.json())
      .then((data: WorkItem[]) => { setWorkItems(data); setWorkLoading(false) })
      .catch(() => setWorkLoading(false))
  }, [])

  useEffect(() => {
    if (!meeting) return
    setWorkLoading(true)
    reloadWorkItems(meeting.id)

    // Realtime 구독 — 작업항목 변경 시 자동 갱신
    const channel = supabase
      .channel(`work_items:${meeting.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'work_items',
        filter: `meeting_id=eq.${meeting.id}`,
      }, () => reloadWorkItems(meeting.id))
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [meeting, supabase, reloadWorkItems])

  // ── 자재 슬롯 로드 + 실시간 구독 ─────────────────────────
  const reloadSlots = useCallback((meetingId: string) => {
    fetch(`/api/material-slots?meetingId=${meetingId}`)
      .then(r => r.json())
      .then((data: MaterialSlot[]) => { setSlots(data); setSlotsLoading(false) })
      .catch(() => setSlotsLoading(false))
  }, [])

  useEffect(() => {
    if (!meeting) return
    setSlotsLoading(true)
    reloadSlots(meeting.id)

    // Realtime 구독 — 자재예약 변경 시 자동 갱신
    const channel = supabase
      .channel(`material_slots:${meeting.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'material_reservations',
      }, () => reloadSlots(meeting.id))
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [meeting, supabase, reloadSlots])

  // ── 자료제출 핸들러 ───────────────────────────────────────
  async function handleLoadPrevious() {
    setPrevLoading(true)
    try {
      const res  = await fetch(`/api/previous-submission?teamId=${teamId}`)
      const data = await res.json()
      if (!data.previous) { alert('이전에 제출한 내용이 없습니다.'); return }
      const prev = data.previous
      const d = prev.personnel_detail
      setPersonnel({
        elderly: String(d?.elderly ?? ''), superElderly: String(d?.superElderly ?? ''),
        foreign: String(d?.foreign ?? ''), female: String(d?.female ?? ''),
        diseased: String(d?.diseased ?? ''), total: String(prev.personnel_count ?? ''),
      })
      if (prev.work_process) setWorkProcess(prev.work_process)
      if (prev.equipment) {
        const parsed = prev.equipment.split(',').map((part: string) => {
          const m = part.trim().match(/^(.+?)\s+(\d+)대$/)
          if (m) {
            const type = m[1].trim()
            return { type, count: m[2], isCustom: !EQUIPMENT_LIST.includes(type) }
          }
          return { type: part.trim(), count: '', isCustom: true }
        }).filter((r: {type: string}) => r.type)
        if (parsed.length > 0) setEquipRows(parsed)
      }
      const meetings = prev.meetings as { date?: string } | null
      setPrevDate(meetings?.date ?? prev.submitted_at?.split('T')[0] ?? null)
      setPrevLoaded(true)
    } catch { alert('이전 내용을 불러오는 중 오류가 발생했습니다.') }
    setPrevLoading(false)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) validateAndSetFile(dropped)
  }, []) // eslint-disable-line

  function validateAndSetFile(f: File) {
    if (f.type !== 'application/pdf') {
      setErrors(prev => ({ ...prev, file: 'PDF 파일만 업로드할 수 있습니다.' })); return
    }
    if (f.size > MAX_FILE_BYTES) {
      setErrors(prev => ({ ...prev, file: `파일 크기는 ${MAX_FILE_MB}MB 이하여야 합니다.` })); return
    }
    setErrors(prev => { const next = { ...prev }; delete next.file; return next })
    setFile(f)
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!personnel.total || Number(personnel.total) <= 0)
      errs.personnelTotal = '총 인원을 올바르게 입력해 주세요.'
    if (!workProcess.trim())
      errs.workProcess = '작업공정을 입력해 주세요.'
    // 장비·PDF 모두 선택사항
    setErrors(errs); return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !meeting) return
    setStep('uploading'); setProgress(0); setErrorMsg('')
    try {
      const equipStr = equipRows
        .filter(r => r.type && Number(r.count) > 0)
        .map(r => `${r.type} ${r.count}대`).join(', ')

      const fd = new FormData()
      fd.append('team_id',          teamId)
      fd.append('meeting_id',       meeting.id)
      fd.append('personnel_count',  personnel.total)
      fd.append('personnel_detail', JSON.stringify({
        elderly:      Number(personnel.elderly)      || 0,
        superElderly: Number(personnel.superElderly) || 0,
        foreign:      Number(personnel.foreign)      || 0,
        female:       Number(personnel.female)       || 0,
        diseased:     Number(personnel.diseased)     || 0,
      }))
      fd.append('work_process', workProcess)
      fd.append('equipment',    equipStr)
      if (file) fd.append('file', file)

      const xhr = new XMLHttpRequest()
      const result = await new Promise<string>((resolve, reject) => {
        xhr.upload.onprogress = ev => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 90))
        }
        xhr.onload  = () => xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText))
        xhr.onerror = () => reject(new Error('네트워크 오류'))
        xhr.open('POST', '/api/submit'); xhr.send(fd)
      })

      const { signedUrl } = JSON.parse(result)
      setDownloadUrl(signedUrl ?? ''); setProgress(100); setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '오류가 발생했습니다.')
      setStep('error')
    }
  }

  // ── 작업항목 핸들러 ───────────────────────────────────────
  async function addWorkItem(workType: 'high_risk' | 'general', data: Partial<WorkItem>) {
    if (!meeting) return
    await fetch('/api/work-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meeting.id, work_type: workType, team_id: teamId, ...data }),
    })
    // Realtime이 자동으로 갱신하지만 즉시성을 위해 reload
    reloadWorkItems(meeting.id)
  }

  async function deleteWorkItem(id: string) {
    await fetch(`/api/work-items?id=${id}`, { method: 'DELETE' })
    setWorkItems(prev => prev.filter(i => i.id !== id))
  }

  // ── 자재 예약 핸들러 ─────────────────────────────────────
  async function reserveSlot(slotId: string, desc: string, qty: string, vehicle: string) {
    const res = await fetch('/api/material-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, teamId, materialDescription: desc, quantity: qty, vehicleType: vehicle }),
    })
    if (!res.ok) {
      const err = await res.json()
      alert(err.error || '예약 실패')
      return
    }
    // 즉시 갱신 (Realtime 보완)
    if (meeting) reloadSlots(meeting.id)
  }

  async function cancelReservation(reservationId: string) {
    await fetch(`/api/material-slots?reservationId=${reservationId}`, { method: 'DELETE' })
    // Realtime이 자동 갱신
  }

  const isClosed = meeting?.status === 'closed'

  // ── 로딩 / 오류 상태 ─────────────────────────────────────
  if (loading) return <FullPageSpinner />
  if (!team)   return <ErrorPage message="업체 정보를 찾을 수 없습니다." />

  // 지도가 있는지 여부
  const hasMap = !!meeting?.map_file_url

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 공지사항 팝업 ──────────────────────────────────── */}
      {showPopup && announcements[popupIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-8 border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">공지사항</h2>
            <p className="text-xs text-gray-500 mb-4">{popupIdx + 1}/{announcements.length}</p>
            <h3 className="font-medium text-gray-900 mb-2">{announcements[popupIdx].title}</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap mb-6">
              {announcements[popupIdx].content}
            </p>
            <div className="flex gap-2">
              {popupIdx < announcements.length - 1 ? (
                <button onClick={() => setPopupIdx(i => i + 1)}
                  className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors">
                  다음 공지
                </button>
              ) : (
                <button onClick={() => setShowPopup(false)}
                  className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors">
                  확인
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 헤더 ───────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-gray-900 leading-tight truncate">{team.name}</h1>
            {meeting
              ? <p className="text-xs text-gray-500 truncate">{meeting.title} · {meeting.date}</p>
              : <p className="text-xs text-gray-500">DABs 자료 취합 시스템</p>
            }
          </div>
          {isClosed && (
            <span className="shrink-0 px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg ml-4">
              마감됨
            </span>
          )}
          {hasMap && !isClosed && (
            <span className="shrink-0 flex items-center gap-1.5 text-xs text-emerald-600 font-medium ml-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              실시간 공유 중
            </span>
          )}
        </div>
      </header>

      {/* ── 메인 레이아웃 ──────────────────────────────────── */}
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        {!meeting && noMeeting ? (
          <div className="text-center py-20">
            <p className="text-gray-500">오늘 예정된 회의가 없습니다.</p>
          </div>
        ) : (
          <div className={hasMap
            ? 'grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6 items-start'
            : 'max-w-2xl mx-auto'
          }>

            {/* ── 왼쪽: 협업 지도 ───────────────────────────── */}
            {hasMap && (
              <div className="xl:sticky xl:top-[73px]">
                <MapAnnotator
                  meetingId={meeting!.id}
                  mapUrl={meeting!.map_file_url!}
                  myTeamId={teamId}
                  allTeamIds={allTeams.map(t => t.id)}
                  readOnly={false}
                />
              </div>
            )}

            {/* ── 오른쪽: 탭 + 폼 ───────────────────────────── */}
            <div>
              {/* 탭 네비게이션 */}
              <div className="bg-white border-b border-gray-200 flex overflow-x-auto px-4">
                {([
                  { key: 'high_risk', label: '고위험작업' },
                  { key: 'general',   label: '일반작업' },
                  { key: 'material',  label: '자재하역' },
                  { key: 'submit',    label: '자료제출' },
                ] as { key: Tab; label: string }[]).map(t => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={[
                      'px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                      activeTab === t.key
                        ? 'border-gray-900 text-gray-900 font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-700',
                    ].join(' ')}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* 탭 콘텐츠 */}
              <div className="bg-white border border-gray-200 border-t-0 rounded-b-xl p-5 min-h-[400px]">

                {/* ── 고위험작업 ─────────────────────────────── */}
                {activeTab === 'high_risk' && (
                  <WorkItemTab
                    workType="high_risk" label="고위험작업" color="red"
                    isClosed={isClosed}
                    items={workItems.filter(i => i.work_type === 'high_risk')}
                    isLoading={workLoading}
                    myTeamId={teamId} myTeamName={team.name}
                    onAdd={data => addWorkItem('high_risk', data)}
                    onDelete={deleteWorkItem}
                  />
                )}

                {/* ── 일반작업 ───────────────────────────────── */}
                {activeTab === 'general' && (
                  <WorkItemTab
                    workType="general" label="일반작업" color="blue"
                    isClosed={isClosed}
                    items={workItems.filter(i => i.work_type === 'general')}
                    isLoading={workLoading}
                    myTeamId={teamId} myTeamName={team.name}
                    onAdd={data => addWorkItem('general', data)}
                    onDelete={deleteWorkItem}
                  />
                )}

                {/* ── 자재하역/운반 ──────────────────────────── */}
                {activeTab === 'material' && (
                  <MaterialTab
                    isClosed={isClosed}
                    slots={slots}
                    isLoading={slotsLoading}
                    myTeamId={teamId} myTeamName={team.name}
                    onReserve={reserveSlot}
                    onCancel={cancelReservation}
                  />
                )}

                {/* ── 자료제출 ───────────────────────────────── */}
                {activeTab === 'submit' && (
                  <SubmitTab
                    meeting={meeting} isClosed={isClosed}
                    personnel={personnel} setPersonnel={setPersonnel}
                    workProcess={workProcess} setWorkProcess={setWorkProcess}
                    equipRows={equipRows} setEquipRows={setEquipRows}
                    file={file} setFile={setFile}
                    dragOver={dragOver} setDragOver={setDragOver}
                    errors={errors}
                    step={step} progress={progress}
                    errorMsg={errorMsg} downloadUrl={downloadUrl}
                    prevLoading={prevLoading} prevDate={prevDate} prevLoaded={prevLoaded}
                    fileInputRef={fileInputRef}
                    onLoadPrevious={handleLoadPrevious}
                    onDrop={handleDrop}
                    onFileChange={f => validateAndSetFile(f)}
                    onSubmit={handleSubmit}
                  />
                )}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  )
}

// ============================================================
// 탭 컴포넌트들
// ============================================================

// ── 자료제출 탭 ───────────────────────────────────────────────
function SubmitTab({
  meeting, isClosed,
  personnel, setPersonnel, workProcess, setWorkProcess,
  equipRows, setEquipRows, file, setFile,
  dragOver, setDragOver, errors, step, progress, errorMsg, downloadUrl,
  prevLoading, prevDate, prevLoaded, fileInputRef,
  onLoadPrevious, onDrop, onFileChange, onSubmit,
}: {
  meeting: Meeting | null; isClosed: boolean
  personnel: Record<string, string>; setPersonnel: React.Dispatch<React.SetStateAction<{elderly:string;superElderly:string;foreign:string;female:string;diseased:string;total:string}>>
  workProcess: string; setWorkProcess: (v: string) => void
  equipRows: {type: string; count: string; isCustom: boolean}[]
  setEquipRows: (v: {type: string; count: string; isCustom: boolean}[]) => void
  file: File | null; setFile: (v: File | null) => void
  dragOver: boolean; setDragOver: (v: boolean) => void
  errors: Record<string, string>
  step: UploadStep; progress: number; errorMsg: string; downloadUrl: string
  prevLoading: boolean; prevDate: string | null; prevLoaded: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onLoadPrevious: () => void; onDrop: (e: React.DragEvent) => void
  onFileChange: (f: File) => void; onSubmit: (e: React.FormEvent) => void
}) {
  if (!meeting) return (
    <div className="text-center py-20">
      <p className="text-gray-500">오늘 예정된 회의가 없습니다.</p>
    </div>
  )

  if (step === 'done') return (
    <div className="text-center py-12">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">제출 완료</h2>
      <p className="text-gray-500 text-sm mb-6">자료가 성공적으로 업로드되었습니다.</p>
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
          제출 파일 확인
        </a>
      )}
    </div>
  )

  const isUploading = step === 'uploading' || step === 'saving'

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 이전 내용 불러오기 */}
      <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
        <div>
          <p className="text-sm font-medium text-gray-900">이전 제출 내용 불러오기</p>
          {prevLoaded && prevDate && (
            <p className="text-xs text-gray-500">{prevDate} 제출 내용을 불러왔습니다.</p>
          )}
        </div>
        <button type="button" onClick={onLoadPrevious} disabled={prevLoading || isClosed}
          className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
          {prevLoading ? '불러오는 중...' : '불러오기'}
        </button>
      </div>

      {/* 인원 */}
      <Card title="투입 인원">
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'total',        label: '총 인원 *', placeholder: '명' },
            { key: 'elderly',      label: '고령자 (65세↑)', placeholder: '명' },
            { key: 'superElderly', label: '초고령자 (75세↑)', placeholder: '명' },
            { key: 'foreign',      label: '외국인 근로자', placeholder: '명' },
            { key: 'female',       label: '여성 근로자', placeholder: '명' },
            { key: 'diseased',     label: '유질환자', placeholder: '명' },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
              <input type="number" min="0" placeholder={placeholder}
                value={personnel[key as keyof typeof personnel]}
                onChange={e => setPersonnel(prev => ({ ...prev, [key]: e.target.value }))}
                disabled={isClosed}
                className={inputCls}
              />
            </div>
          ))}
        </div>
        {errors.personnelTotal && <p className="text-xs text-red-500 mt-1">{errors.personnelTotal}</p>}
      </Card>

      {/* 작업공정 */}
      <Card title="작업공정">
        <textarea rows={3} placeholder="오늘 진행할 작업 공정을 간략히 입력해 주세요."
          value={workProcess} onChange={e => setWorkProcess(e.target.value)}
          disabled={isClosed}
          className={inputCls + ' resize-none w-full'}
        />
        {errors.workProcess && <p className="text-xs text-red-500 mt-1">{errors.workProcess}</p>}
      </Card>

      {/* 장비 */}
      <Card title="투입 장비 (선택)">
        <div className="space-y-2">
          {equipRows.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              {row.isCustom ? (
                <input type="text" placeholder="장비명 직접 입력"
                  value={row.type}
                  onChange={e => {
                    const next = [...equipRows]; next[idx] = { ...next[idx], type: e.target.value }; setEquipRows(next)
                  }}
                  disabled={isClosed}
                  className={inputCls + ' flex-1'}
                />
              ) : (
                <select value={row.type}
                  onChange={e => {
                    const next = [...equipRows]
                    const val  = e.target.value
                    next[idx]  = val === DIRECT_INPUT_VALUE
                      ? { type: '', count: row.count, isCustom: true }
                      : { ...next[idx], type: val, isCustom: false }
                    setEquipRows(next)
                  }}
                  disabled={isClosed}
                  className={inputCls + ' flex-1'}
                >
                  <option value="">장비 선택</option>
                  {EQUIPMENT_LIST.map(eq => <option key={eq} value={eq}>{eq}</option>)}
                  <option value={DIRECT_INPUT_VALUE}>직접 입력...</option>
                </select>
              )}
              <input type="number" min="1" placeholder="수량"
                value={row.count}
                onChange={e => {
                  const next = [...equipRows]; next[idx] = { ...next[idx], count: e.target.value }; setEquipRows(next)
                }}
                disabled={isClosed}
                className={inputCls + ' w-20'}
              />
              <span className="text-sm text-gray-500 py-2.5">대</span>
              {equipRows.length > 1 && (
                <button type="button" onClick={() => setEquipRows(equipRows.filter((_, i) => i !== idx))}
                  disabled={isClosed}
                  className="p-2.5 text-gray-400 hover:text-red-500 transition-colors">✕</button>
              )}
            </div>
          ))}
        </div>
        {errors.equipment && <p className="text-xs text-red-500 mt-1">{errors.equipment}</p>}
        <button type="button" onClick={() => setEquipRows([...equipRows, { type: '', count: '', isCustom: false }])}
          disabled={isClosed}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors disabled:opacity-50">
          장비 추가
        </button>
      </Card>

      {/* 파일 첨부 */}
      <Card title="PDF 파일 첨부 (선택)">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={[
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300',
            isClosed ? 'opacity-50 pointer-events-none' : '',
          ].join(' ')}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(f) }}
          />
          {file ? (
            <div className="flex items-center justify-start gap-3">
              <div className="text-left flex-1">
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button type="button" onClick={e => { e.stopPropagation(); setFile(null) }}
                className="text-gray-400 hover:text-red-500">✕</button>
            </div>
          ) : (
            <div className="text-gray-400">
              <p className="text-sm">PDF를 여기에 끌어다 놓거나 클릭하여 선택</p>
              <p className="text-xs mt-1 text-gray-500">최대 {MAX_FILE_MB}MB · 첨부하지 않아도 제출 가능</p>
            </div>
          )}
        </div>
        {errors.file && <p className="text-xs text-red-500 mt-1">{errors.file}</p>}
      </Card>

      {/* 업로드 진행 */}
      {isUploading && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex justify-between text-sm mb-3">
            <span className="text-gray-600">{step === 'saving' ? '저장 중...' : '업로드 중...'}</span>
            <span className="font-medium text-gray-900">{progress}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gray-900 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {step === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {!isClosed ? (
        <button type="submit" disabled={isUploading}
          className="w-full py-2.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white font-medium text-sm transition-colors disabled:opacity-50">
          {isUploading ? '제출 중...' : '자료 제출하기'}
        </button>
      ) : (
        <div className="text-center py-4 text-gray-500 text-sm">회의가 마감되었습니다.</div>
      )}
    </form>
  )
}

// ── 작업 항목 탭 (고위험 / 일반 공용) ─────────────────────────
function WorkItemTab({
  workType, label, color, isClosed, items, isLoading, myTeamId, myTeamName, onAdd, onDelete,
}: {
  workType: 'high_risk' | 'general'; label: string; color: 'red' | 'blue'
  isClosed: boolean; items: WorkItem[]; isLoading: boolean
  myTeamId: string; myTeamName: string
  onAdd: (data: Partial<WorkItem>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [showForm,    setShowForm]    = useState(false)
  const [workName,    setWorkName]    = useState('')
  const [location,    setLocation]    = useState('')
  const [workerCount, setWorkerCount] = useState('')
  const [description, setDescription] = useState('')
  const [saving,      setSaving]      = useState(false)

  const colorCls = color === 'red'
    ? { badge: 'text-red-700 text-xs font-medium', btn: 'bg-gray-900 hover:bg-gray-800', border: 'border-gray-200' }
    : { badge: 'text-gray-700 text-xs font-medium', btn: 'bg-gray-900 hover:bg-gray-800', border: 'border-gray-200' }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!workName.trim()) return
    setSaving(true)
    await onAdd({ work_name: workName, location, worker_count: Number(workerCount) || 0, description })
    setWorkName(''); setLocation(''); setWorkerCount(''); setDescription('')
    setShowForm(false); setSaving(false)
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">{label} 현황</h2>
          <p className="text-xs text-gray-500 mt-0.5">모든 협력업체가 함께 등록 · 실시간 공유</p>
        </div>
        {!isClosed && (
          <button onClick={() => setShowForm(true)}
            className={`px-4 py-2 ${colorCls.btn} text-white text-sm font-medium rounded-lg transition-colors`}>
            작업 추가
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-medium text-gray-900 mb-4">새 {label} 등록</h3>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">작업명 *</label>
              <input type="text" placeholder="예) 철근 배근 작업" value={workName}
                onChange={e => setWorkName(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">위치/구간</label>
                <input type="text" placeholder="예) A동 3층" value={location}
                  onChange={e => setLocation(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">투입 인원</label>
                <input type="number" min="0" placeholder="명" value={workerCount}
                  onChange={e => setWorkerCount(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">상세 내용</label>
              <textarea rows={2} placeholder="작업 상세 내용" value={description}
                onChange={e => setDescription(e.target.value)}
                className={inputCls + ' resize-none w-full'} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50">
                취소
              </button>
              <button type="submit" disabled={saving}
                className={`flex-1 py-2 ${colorCls.btn} text-white text-sm font-medium rounded-lg transition-colors`}>
                {saving ? '저장 중...' : '등록'}
              </button>
            </div>
          </form>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">등록된 {label}이 없습니다.</p>
          <p className="text-xs mt-1 text-gray-400">다른 업체가 등록하면 여기에 실시간으로 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className={`rounded-lg border p-4 ${colorCls.border} bg-white group`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-medium text-gray-900">{item.work_name}</h3>
                    <span className={`text-xs px-2 py-1 rounded font-medium text-gray-700 bg-gray-100 ${colorCls.badge}`}>
                      {item.teams?.name ?? '미지정'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                    {item.location && <span>{item.location}</span>}
                    {item.worker_count > 0 && <span>{item.worker_count}명</span>}
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-600 mt-2">{item.description}</p>
                  )}
                </div>
                {item.team_id === myTeamId && !isClosed && (
                  <button onClick={() => onDelete(item.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors text-sm p-1 opacity-0 group-hover:opacity-100">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 자재 하역/운반 탭 ─────────────────────────────────────────
function MaterialTab({
  isClosed, slots, isLoading, myTeamId, myTeamName, onReserve, onCancel,
}: {
  isClosed: boolean; slots: MaterialSlot[]; isLoading: boolean
  myTeamId: string; myTeamName: string
  onReserve: (slotId: string, desc: string, qty: string, vehicle: string) => Promise<void>
  onCancel: (reservationId: string) => Promise<void>
}) {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null)
  const [desc,       setDesc]       = useState('')
  const [qty,        setQty]        = useState('')
  const [vehicle,    setVehicle]    = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (isLoading) return <LoadingSpinner />

  async function handleReserve(slotId: string) {
    if (!desc.trim()) { alert('자재 내용을 입력해주세요'); return }
    setSubmitting(true)
    await onReserve(slotId, desc, qty, vehicle)
    setOpenSlotId(null); setDesc(''); setQty(''); setVehicle('')
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900">자재 하역/운반 시간 예약</h2>
        <p className="text-xs text-gray-500 mt-0.5">시간대당 최대 5개 업체 신청 가능 · 실시간 공유</p>
      </div>

      <div className="space-y-2">
        {slots.map(slot => {
          const reservations = slot.material_reservations ?? []
          const count  = reservations.length
          const isFull = count >= slot.max_teams
          const myRes  = reservations.find(r => r.team_id === myTeamId)
          const isOpen = openSlotId === slot.id

          return (
            <div key={slot.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900">{slot.slot_time}</span>
                  <div className="flex gap-1">
                    {Array.from({ length: slot.max_teams }).map((_, i) => (
                      <div key={i} className={['w-2 h-2 rounded-full', i < count ? 'bg-emerald-500' : 'bg-gray-200'].join(' ')} />
                    ))}
                  </div>
                  <span className="text-xs text-gray-500">{count}/{slot.max_teams}</span>
                </div>
                {isFull ? (
                  <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded">마감</span>
                ) : myRes ? (
                  <button onClick={() => onCancel(myRes.id)}
                    className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors">예약취소</button>
                ) : !isClosed ? (
                  <button onClick={() => setOpenSlotId(isOpen ? null : slot.id)}
                    className="text-xs font-medium px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded transition-colors">
                    {isOpen ? '취소' : '신청'}
                  </button>
                ) : null}
              </div>

              {isOpen && !myRes && !isFull && (
                <div className="border-t border-gray-200 px-4 py-4 bg-gray-50 space-y-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">자재 내용 *</label>
                    <input type="text" placeholder="예) 철근 20톤" value={desc}
                      onChange={e => setDesc(e.target.value)} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">수량/규격</label>
                      <input type="text" placeholder="예) 20톤" value={qty}
                        onChange={e => setQty(e.target.value)} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">차량 종류</label>
                      <select value={vehicle} onChange={e => setVehicle(e.target.value)} className={inputCls}>
                        <option value="">선택</option>
                        {VEHICLE_LIST.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={() => handleReserve(slot.id)} disabled={submitting}
                    className="w-full py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? '신청 중...' : '예약 신청'}
                  </button>
                </div>
              )}

              {reservations.length > 0 && (
                <div className="border-t border-gray-200 divide-y divide-gray-100">
                  {reservations.map(r => (
                    <div key={r.id} className={[
                      'flex items-center gap-3 px-4 py-2.5 text-xs',
                      r.team_id === myTeamId ? 'bg-gray-50' : 'bg-white',
                    ].join(' ')}>
                      <span className="font-medium text-gray-900">{r.teams?.name ?? '업체'}</span>
                      {r.material_description && <span className="text-gray-600">{r.material_description}</span>}
                      {r.quantity && <span className="text-gray-500">· {r.quantity}</span>}
                      {r.vehicle_type && <span className="text-gray-500">· {r.vehicle_type}</span>}
                      {r.team_id === myTeamId && (
                        <span className="ml-auto text-emerald-600 font-medium">내 예약</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-500">{message}</p>
      </div>
    </div>
  )
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 ' +
  'outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ' +
  'placeholder:text-gray-400 transition-colors disabled:opacity-50 disabled:bg-gray-50'
