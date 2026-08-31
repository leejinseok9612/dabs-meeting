// ============================================================
// app/submit/[teamId]/page.tsx — DABs 협력업체 통합 제출 페이지 v2
// 탭: 자료제출 | 고위험작업 | 일반작업 | 자재하역/운반
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
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

type Tab       = 'map' | 'submit' | 'high_risk' | 'general' | 'material'
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
  const params = useParams()
  const teamId = params.teamId as string

  // 공통
  const [team,        setTeam]        = useState<Team | null>(null)
  const [allTeams,    setAllTeams]    = useState<Team[]>([])
  const [meeting,     setMeeting]     = useState<Meeting | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [noMeeting,   setNoMeeting]   = useState(false)
  const [activeTab,   setActiveTab]   = useState<Tab>('map')

  // 공지사항
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [showPopup,     setShowPopup]     = useState(false)
  const [popupIdx,      setPopupIdx]      = useState(0)

  // 작업 항목
  const [workItems,     setWorkItems]     = useState<WorkItem[]>([])
  const [workLoading,   setWorkLoading]   = useState(false)

  // 자재 슬롯
  const [slots,         setSlots]         = useState<MaterialSlot[]>([])
  const [slotsLoading,  setSlotsLoading]  = useState(false)

  // ── 자료제출 폼 상태 ─────────────────────────────────────
  const [personnel, setPersonnel] = useState({
    elderly: '', superElderly: '', foreign: '', female: '', diseased: '', total: '',
  })
  const [workProcess,  setWorkProcess]  = useState('')
  const [equipRows,    setEquipRows]    = useState<{type: string; count: string; isCustom: boolean}[]>([
    { type: '', count: '', isCustom: false },
  ])
  const [file,         setFile]         = useState<File | null>(null)
  const [dragOver,     setDragOver]     = useState(false)
  const [errors,       setErrors]       = useState<Record<string, string>>({})
  const [step,         setStep]         = useState<UploadStep>('idle')
  const [progress,     setProgress]     = useState(0)
  const [errorMsg,     setErrorMsg]     = useState('')
  const [downloadUrl,  setDownloadUrl]  = useState('')
  const [prevLoading,  setPrevLoading]  = useState(false)
  const [prevDate,     setPrevDate]     = useState<string | null>(null)
  const [prevLoaded,   setPrevLoaded]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 초기 데이터 로드 ──────────────────────────────────────
  useEffect(() => {
    async function load() {
      const res  = await fetch(`/api/submit-info?teamId=${teamId}`)
      if (res.status === 404) { setLoading(false); return }
      const data = await res.json()
      if (!data.team) { setLoading(false); return }
      setTeam(data.team)
      if (!data.meeting) { setNoMeeting(true) }
      else { setMeeting(data.meeting) }
      setLoading(false)
    }
    // 전체 팀 목록 로드 (지도 범례용)
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

  // 공지사항 로드
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

  // 작업 항목 로드
  useEffect(() => {
    if (!meeting) return
    setWorkLoading(true)
    fetch(`/api/work-items?meetingId=${meeting.id}`)
      .then(r => r.json())
      .then((data: WorkItem[]) => { setWorkItems(data); setWorkLoading(false) })
      .catch(() => setWorkLoading(false))
  }, [meeting])

  // 자재 슬롯 로드 (탭 전환 시)
  useEffect(() => {
    if (!meeting || activeTab !== 'material') return
    setSlotsLoading(true)
    fetch(`/api/material-slots?meetingId=${meeting.id}`)
      .then(r => r.json())
      .then((data: MaterialSlot[]) => { setSlots(data); setSlotsLoading(false) })
      .catch(() => setSlotsLoading(false))
  }, [meeting, activeTab])

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
    const validEquip = equipRows.filter(r => r.type && Number(r.count) > 0)
    if (validEquip.length === 0)
      errs.equipment = '투입 장비를 1개 이상 입력해 주세요.'
    if (!file)
      errs.file = 'PDF 파일을 첨부해 주세요.'
    setErrors(errs); return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !meeting) return
    setStep('uploading'); setProgress(0); setErrorMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file!)
      fd.append('teamId', teamId)
      fd.append('meetingId', meeting.id)
      const xhr = new XMLHttpRequest()
      const uploadDone = await new Promise<string>((resolve, reject) => {
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 80))
        }
        xhr.onload  = () => xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText))
        xhr.onerror = () => reject(new Error('네트워크 오류'))
        xhr.open('POST', '/api/submit'); xhr.send(fd)
      })
      setProgress(90); setStep('saving')
      const { filePath } = JSON.parse(uploadDone)
      const equipStr = equipRows
        .filter(r => r.type && Number(r.count) > 0)
        .map(r => `${r.type} ${r.count}대`)
        .join(', ')
      const infoRes = await fetch('/api/submit-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId, meetingId: meeting.id, filePath,
          personnelCount: Number(personnel.total),
          personnelDetail: {
            elderly: Number(personnel.elderly) || 0,
            superElderly: Number(personnel.superElderly) || 0,
            foreign: Number(personnel.foreign) || 0,
            female: Number(personnel.female) || 0,
            diseased: Number(personnel.diseased) || 0,
          },
          equipment: equipStr, workProcess,
        }),
      })
      if (!infoRes.ok) throw new Error(await infoRes.text())
      const { downloadUrl: url } = await infoRes.json()
      setDownloadUrl(url); setProgress(100); setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '오류가 발생했습니다.')
      setStep('error')
    }
  }

  // ── 작업항목 핸들러 ───────────────────────────────────────
  async function addWorkItem(workType: 'high_risk' | 'general', data: Partial<WorkItem>) {
    if (!meeting) return
    const res = await fetch('/api/work-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meeting.id, work_type: workType, team_id: teamId, ...data }),
    })
    const item = await res.json()
    setWorkItems(prev => [...prev, item])
  }

  async function deleteWorkItem(id: string) {
    await fetch(`/api/work-items?id=${id}`, { method: 'DELETE' })
    setWorkItems(prev => prev.filter(i => i.id !== id))
  }

  // 자재 예약 핸들러
  async function reserveSlot(slotId: string, desc: string, qty: string, vehicle: string) {
    if (!teamId) return
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
    // 슬롯 새로고침
    if (meeting) {
      const updated = await fetch(`/api/material-slots?meetingId=${meeting.id}`).then(r => r.json())
      setSlots(updated)
    }
  }

  async function cancelReservation(reservationId: string) {
    await fetch(`/api/material-slots?reservationId=${reservationId}`, { method: 'DELETE' })
    if (meeting) {
      const updated = await fetch(`/api/material-slots?meetingId=${meeting.id}`).then(r => r.json())
      setSlots(updated)
    }
  }

  // ── 로딩 / 오류 상태 ─────────────────────────────────────
  if (loading) return <FullPageSpinner />
  if (!team)   return <ErrorPage message="업체 정보를 찾을 수 없습니다." />

  const isClosed = meeting?.status === 'closed'

  return (
    <div className="min-h-screen bg-slate-100">
      {/* 공지사항 팝업 */}
      {showPopup && announcements[popupIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-[fadeInUp_0.2s_ease]">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">📢</span>
              <h2 className="text-lg font-bold text-slate-800">공지사항</h2>
              <span className="ml-auto text-xs text-slate-400">{popupIdx + 1}/{announcements.length}</span>
            </div>
            <h3 className="font-semibold text-slate-700 mb-2">{announcements[popupIdx].title}</h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap mb-6">
              {announcements[popupIdx].content}
            </p>
            <div className="flex gap-2">
              {popupIdx < announcements.length - 1 ? (
                <button
                  onClick={() => setPopupIdx(i => i + 1)}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  다음 공지 →
                </button>
              ) : (
                <button
                  onClick={() => setShowPopup(false)}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  확인
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <span className="text-lg">📋</span>
          </div>
          <div>
            <h1 className="font-bold text-slate-800 leading-tight">{team.name}</h1>
            {meeting
              ? <p className="text-xs text-slate-400">{meeting.title} · {meeting.date}</p>
              : <p className="text-xs text-slate-400">DABs 자료 취합 시스템</p>
            }
          </div>
          {isClosed && (
            <span className="ml-auto px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-semibold rounded-full">
              마감됨
            </span>
          )}
        </div>

        {/* 탭 네비게이션 */}
        <div className="max-w-2xl mx-auto px-4 flex gap-0 border-t border-slate-100 overflow-x-auto">
          {([
            { key: 'map',       label: '🗺️ 협업 지도' },
            { key: 'submit',    label: '📄 자료제출' },
            { key: 'high_risk', label: '⚠️ 고위험작업' },
            { key: 'general',   label: '🔧 일반작업' },
            { key: 'material',  label: '🚛 자재하역/운반' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={[
                'px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                activeTab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {!meeting && noMeeting ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-4">📭</p>
            <p className="text-slate-500">오늘 예정된 회의가 없습니다.</p>
          </div>
        ) : (
          <>
            {/* ── 탭: 협업 지도 ──────────────────────────────── */}
            {activeTab === 'map' && (
              <div>
                {meeting?.map_file_url ? (
                  <MapAnnotator
                    meetingId={meeting.id}
                    mapUrl={meeting.map_file_url}
                    myTeamId={teamId}
                    allTeamIds={allTeams.map(t => t.id)}
                    readOnly={false}
                  />
                ) : (
                  <div className="text-center py-20">
                    <p className="text-4xl mb-4">🗺️</p>
                    <p className="text-slate-500">관리자가 지적도를 업로드하면 여기에 표시됩니다.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── 탭: 자료제출 ───────────────────────────────── */}
            {activeTab === 'submit' && (
              <SubmitTab
                meeting={meeting}
                isClosed={isClosed}
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

            {/* ── 탭: 고위험작업 ──────────────────────────────── */}
            {activeTab === 'high_risk' && (
              <WorkItemTab
                workType="high_risk"
                label="고위험작업"
                color="red"
                isClosed={isClosed}
                items={workItems.filter(i => i.work_type === 'high_risk')}
                isLoading={workLoading}
                myTeamId={teamId}
                myTeamName={team.name}
                onAdd={data => addWorkItem('high_risk', data)}
                onDelete={deleteWorkItem}
              />
            )}

            {/* ── 탭: 일반작업 ──────────────────────────────── */}
            {activeTab === 'general' && (
              <WorkItemTab
                workType="general"
                label="일반작업"
                color="blue"
                isClosed={isClosed}
                items={workItems.filter(i => i.work_type === 'general')}
                isLoading={workLoading}
                myTeamId={teamId}
                myTeamName={team.name}
                onAdd={data => addWorkItem('general', data)}
                onDelete={deleteWorkItem}
              />
            )}

            {/* ── 탭: 자재하역/운반 ──────────────────────────── */}
            {activeTab === 'material' && (
              <MaterialTab
                isClosed={isClosed}
                slots={slots}
                isLoading={slotsLoading}
                myTeamId={teamId}
                myTeamName={team.name}
                onReserve={reserveSlot}
                onCancel={cancelReservation}
              />
            )}
          </>
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
      <p className="text-4xl mb-4">📭</p>
      <p className="text-slate-500">오늘 예정된 회의가 없습니다.</p>
    </div>
  )

  if (step === 'done') return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">제출 완료!</h2>
      <p className="text-slate-500 text-sm mb-6">자료가 성공적으로 업로드되었습니다.</p>
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
          📄 제출 파일 확인
        </a>
      )}
    </div>
  )

  const isUploading = step === 'uploading' || step === 'saving'

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 이전 내용 불러오기 */}
      <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-5 py-3">
        <div>
          <p className="text-sm font-medium text-blue-700">이전 제출 내용 불러오기</p>
          {prevLoaded && prevDate && (
            <p className="text-xs text-blue-500">{prevDate} 제출 내용을 불러왔습니다.</p>
          )}
        </div>
        <button type="button" onClick={onLoadPrevious} disabled={prevLoading || isClosed}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {prevLoading ? '불러오는 중...' : '불러오기'}
        </button>
      </div>

      {/* 인원 */}
      <Card title="👷 투입 인원">
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
              <label className="block text-xs font-medium text-slate-600">{label}</label>
              <input type="number" min="0" placeholder={placeholder}
                value={personnel[key as keyof typeof personnel]}
                onChange={e => setPersonnel(prev => ({ ...prev, [key]: e.target.value }))}
                disabled={isClosed}
                className={inputCls + (key === 'total' ? ' col-span-2' : '')}
              />
            </div>
          ))}
        </div>
        {errors.personnelTotal && <p className="text-xs text-red-500 mt-1">⚠️ {errors.personnelTotal}</p>}
      </Card>

      {/* 작업공정 */}
      <Card title="📋 작업공정">
        <textarea rows={3} placeholder="오늘 진행할 작업 공정을 간략히 입력해 주세요."
          value={workProcess} onChange={e => setWorkProcess(e.target.value)}
          disabled={isClosed}
          className={inputCls + ' resize-none w-full'}
        />
        {errors.workProcess && <p className="text-xs text-red-500 mt-1">⚠️ {errors.workProcess}</p>}
      </Card>

      {/* 장비 */}
      <Card title="🚧 투입 장비">
        <div className="space-y-2">
          {equipRows.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              {row.isCustom ? (
                <input type="text" placeholder="장비명 직접 입력"
                  value={row.type}
                  onChange={e => {
                    const next = [...equipRows]
                    next[idx] = { ...next[idx], type: e.target.value }
                    setEquipRows(next)
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
              <span className="text-sm text-slate-500 py-2.5">대</span>
              {equipRows.length > 1 && (
                <button type="button" onClick={() => setEquipRows(equipRows.filter((_, i) => i !== idx))}
                  disabled={isClosed}
                  className="p-2.5 text-slate-400 hover:text-red-500 transition-colors">✕</button>
              )}
            </div>
          ))}
        </div>
        {errors.equipment && <p className="text-xs text-red-500 mt-1">⚠️ {errors.equipment}</p>}
        <button type="button" onClick={() => setEquipRows([...equipRows, { type: '', count: '', isCustom: false }])}
          disabled={isClosed}
          className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2 disabled:opacity-50">
          + 장비 추가
        </button>
      </Card>

      {/* 파일 첨부 */}
      <Card title="📎 PDF 파일 첨부">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={[
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300',
            isClosed ? 'opacity-50 pointer-events-none' : '',
          ].join(' ')}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(f) }}
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <span className="text-2xl">📄</span>
              <div className="text-left">
                <p className="text-sm font-medium text-slate-700">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button type="button" onClick={e => { e.stopPropagation(); setFile(null) }}
                className="ml-2 text-slate-400 hover:text-red-500">✕</button>
            </div>
          ) : (
            <div className="text-slate-400">
              <p className="text-3xl mb-2">☁️</p>
              <p className="text-sm">PDF를 여기에 끌어다 놓거나 클릭하여 선택</p>
              <p className="text-xs mt-1">최대 {MAX_FILE_MB}MB</p>
            </div>
          )}
        </div>
        {errors.file && <p className="text-xs text-red-500 mt-1">⚠️ {errors.file}</p>}
      </Card>

      {/* 업로드 진행 */}
      {isUploading && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-600">{step === 'saving' ? '저장 중...' : '업로드 중...'}</span>
            <span className="font-medium text-blue-600">{progress}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {step === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {!isClosed ? (
        <button type="submit" disabled={isUploading}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors disabled:opacity-50">
          {isUploading ? '제출 중...' : '자료 제출하기 →'}
        </button>
      ) : (
        <div className="text-center py-4 text-slate-400 text-sm">회의가 마감되었습니다.</div>
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
    ? { badge: 'bg-red-100 text-red-700', btn: 'bg-red-600 hover:bg-red-700', border: 'border-red-200' }
    : { badge: 'bg-blue-100 text-blue-700', btn: 'bg-blue-600 hover:bg-blue-700', border: 'border-blue-200' }

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
          <h2 className="font-semibold text-slate-700">{label} 현황</h2>
          <p className="text-xs text-slate-400 mt-0.5">모든 협력업체가 함께 작업 내용을 등록합니다</p>
        </div>
        {!isClosed && (
          <button onClick={() => setShowForm(true)}
            className={`px-4 py-2 ${colorCls.btn} text-white text-sm font-semibold rounded-lg transition-colors`}>
            + 작업 추가
          </button>
        )}
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-medium text-slate-700 mb-4">새 {label} 등록</h3>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600">작업명 *</label>
              <input type="text" placeholder="예) 철근 배근 작업" value={workName}
                onChange={e => setWorkName(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">위치/구간</label>
                <input type="text" placeholder="예) A동 3층" value={location}
                  onChange={e => setLocation(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">투입 인원</label>
                <input type="number" min="0" placeholder="명" value={workerCount}
                  onChange={e => setWorkerCount(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600">상세 내용</label>
              <textarea rows={2} placeholder="작업 상세 내용" value={description}
                onChange={e => setDescription(e.target.value)}
                className={inputCls + ' resize-none w-full'} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                취소
              </button>
              <button type="submit" disabled={saving}
                className={`flex-1 py-2 ${colorCls.btn} text-white text-sm font-semibold rounded-lg transition-colors`}>
                {saving ? '저장 중...' : '등록'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 작업 목록 */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-3xl mb-3">{color === 'red' ? '⚠️' : '🔧'}</p>
          <p className="text-sm">등록된 {label}이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className={`bg-white rounded-xl border p-4 ${colorCls.border}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-slate-800">{item.work_name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorCls.badge}`}>
                      {item.teams?.name ?? '미지정'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    {item.location && <span>📍 {item.location}</span>}
                    {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                  </div>
                  {item.description && (
                    <p className="text-xs text-slate-500 mt-1.5">{item.description}</p>
                  )}
                </div>
                {item.team_id === myTeamId && !isClosed && (
                  <button onClick={() => onDelete(item.id)}
                    className="text-slate-300 hover:text-red-400 transition-colors text-sm p-1">
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
  const [openSlotId,  setOpenSlotId]  = useState<string | null>(null)
  const [desc,        setDesc]        = useState('')
  const [qty,         setQty]         = useState('')
  const [vehicle,     setVehicle]     = useState('')
  const [submitting,  setSubmitting]  = useState(false)

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
        <h2 className="font-semibold text-slate-700">자재 하역/운반 시간 예약</h2>
        <p className="text-xs text-slate-400 mt-0.5">시간대당 최대 5개 업체 신청 가능 · 초과 시 자동 마감</p>
      </div>

      <div className="space-y-2">
        {slots.map(slot => {
          const reservations = slot.material_reservations ?? []
          const count        = reservations.length
          const isFull       = count >= slot.max_teams
          const myRes        = reservations.find(r => r.team_id === myTeamId)
          const isOpen       = openSlotId === slot.id

          return (
            <div key={slot.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* 슬롯 헤더 */}
              <div className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-800">🕐 {slot.slot_time}</span>
                  <div className="flex gap-1">
                    {Array.from({ length: slot.max_teams }).map((_, i) => (
                      <div key={i} className={[
                        'w-3 h-3 rounded-full',
                        i < count ? 'bg-orange-400' : 'bg-slate-200',
                      ].join(' ')} />
                    ))}
                  </div>
                  <span className="text-xs text-slate-400">{count}/{slot.max_teams}</span>
                </div>
                {isFull ? (
                  <span className="text-xs font-semibold px-2.5 py-1 bg-red-100 text-red-600 rounded-full">
                    마감
                  </span>
                ) : myRes ? (
                  <button onClick={() => onCancel(myRes.id)}
                    className="text-xs text-red-400 hover:text-red-600 underline underline-offset-2">
                    예약취소
                  </button>
                ) : !isClosed ? (
                  <button onClick={() => setOpenSlotId(isOpen ? null : slot.id)}
                    className="text-xs font-semibold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
                    {isOpen ? '취소' : '신청'}
                  </button>
                ) : null}
              </div>

              {/* 예약 폼 */}
              {isOpen && !myRes && !isFull && (
                <div className="border-t border-slate-100 px-5 py-4 bg-slate-50 space-y-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-600">자재 내용 *</label>
                    <input type="text" placeholder="예) 철근 20톤" value={desc}
                      onChange={e => setDesc(e.target.value)} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">수량/규격</label>
                      <input type="text" placeholder="예) 20톤" value={qty}
                        onChange={e => setQty(e.target.value)} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">차량 종류</label>
                      <select value={vehicle} onChange={e => setVehicle(e.target.value)} className={inputCls}>
                        <option value="">선택</option>
                        {VEHICLE_LIST.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={() => handleReserve(slot.id)} disabled={submitting}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? '신청 중...' : '예약 신청'}
                  </button>
                </div>
              )}

              {/* 예약 목록 */}
              {reservations.length > 0 && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {reservations.map(r => (
                    <div key={r.id} className={[
                      'flex items-center gap-3 px-5 py-2.5 text-xs',
                      r.team_id === myTeamId ? 'bg-emerald-50' : '',
                    ].join(' ')}>
                      <span className="font-semibold text-slate-700">{r.teams?.name ?? '업체'}</span>
                      {r.material_description && <span className="text-slate-500">{r.material_description}</span>}
                      {r.quantity && <span className="text-slate-400">· {r.quantity}</span>}
                      {r.vehicle_type && <span className="text-slate-400">· {r.vehicle_type}</span>}
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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-center">
        <p className="text-4xl mb-4">😕</p>
        <p className="text-slate-500">{message}</p>
      </div>
    </div>
  )
}

const inputCls =
  'w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-800 ' +
  'outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ' +
  'placeholder:text-slate-300 transition-colors disabled:opacity-50 disabled:bg-slate-50'
