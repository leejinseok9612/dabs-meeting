// ============================================================
// app/components/views/SubmitView.tsx
// 지적도가 고위험/일반작업 탭에 통합되어 마커 배치 시 작업항목 자동 추가
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

import { createClient } from '@/lib/supabase/client'
import MapAnnotator, { MARKER_TYPES, MapMarker } from '@/app/components/MapAnnotator'
import { toast } from '@/app/components/Toast'

// ── 타입 ────────────────────────────────────────────────────
interface Team    { id: string; name: string; department?: string }
interface Meeting { id: string; title: string; date: string; status: 'open' | 'closed'; map_file_url?: string; map_file_name?: string }
interface Announcement { id: string; title: string; content: string }
interface WorkItem {
  id: string; work_type: 'high_risk' | 'general'; team_id: string
  work_name: string; location?: string; worker_count: number; description?: string
  risk_factors?: string; improvement_measures?: string
  teams?: { id: string; name: string }
}
interface MaterialReservation {
  id: string; team_id: string; material_description?: string
  quantity?: string; vehicle_type?: string
  unloading_location?: string; contact_person?: string
  teams?: { id: string; name: string }
}
interface MaterialSlot {
  id: string; slot_time: string; max_teams: number; gate: string
  material_reservations: MaterialReservation[]
}

type Tab        = 'high_risk' | 'general' | 'material' | 'submit'
type UploadStep = 'idle' | 'uploading' | 'saving' | 'done' | 'error'
type ExportFmt  = 'pdf' | 'png' | 'jpg'

interface MapMarkerData {
  id: string; team_id: string | null; marker_type: string
  x_pct: number; y_pct: number; label?: string; work_type?: string
}

// ── 상수 ────────────────────────────────────────────────────
const MAX_FILE_MB    = 10
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
const DRAFT_KEY      = (teamId: string) => `dabs_draft_${teamId}`

const TEAM_COLORS = ['#3B82F6','#F97316','#22C55E','#8B5CF6','#EF4444','#EC4899']
const MARKER_ICONS: Record<string, string> = {
  excavator: '⛏️', small_exc: '🛠️', crane: '🏗️', tower_crane: '🗼',
  dump_truck: '🚛', pump_car: '💧', concrete_mixer: '🔄',
}

const EQUIPMENT_LIST = [
  '굴착기', '소형굴착기', '로더', '불도저', '모터그레이더',
  '덤프트럭', '콘크리트믹서트럭', '콘크리트펌프카',
  '이동식크레인', '천공기', '항타기', '압쇄기',
  '롤러', '지게차', '살수차', '집게차', '스크레이퍼', '기타',
]
const DIRECT_INPUT_VALUE = '__직접입력__'
const VEHICLE_LIST = ['덤프트럭', '트레일러', '카고트럭', '지게차', '크레인차', '탱크로리', '기타']

// ── 메인 컴포넌트 ─────────────────────────────────────────
export function SubmitView({ teamId, onBack }: { teamId: string; onBack: () => void }) {
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

  // 지도 마커 수 (고위험 / 일반 분리)
  const [myHighRiskCount, setMyHighRiskCount] = useState<number>(0)
  const [myGeneralCount,  setMyGeneralCount]  = useState<number>(0)
  const myMarkerCount = myHighRiskCount + myGeneralCount

  // 작업 카드 hover → 마커 강조
  const [hoveredTeamId, setHoveredTeamId] = useState<string | null>(null)

  // 마커 드롭 → 작업항목 폼 자동 오픈 (마커 라벨을 작업명으로 pre-fill)
  const [pendingMarkerLabel, setPendingMarkerLabel] = useState<string | null>(null)

  // 자재하역 이전 내역 불러오기
  const [prevMaterialData,    setPrevMaterialData]    = useState<{
    desc: string; vehicle: string; vehicleCount: string;
    unloadingLocation: string; contactPerson: string;
  } | null>(null)
  const [prevMaterialLoading, setPrevMaterialLoading] = useState(false)
  const [prevMaterialLoaded,  setPrevMaterialLoaded]  = useState(false)

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
  const [draftSaved,  setDraftSaved]  = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 고위험작업 안내 팝업
  const [showHighRiskGuide, setShowHighRiskGuide] = useState(false)
  const HIGH_RISK_DISMISS_KEY = `dabs_highrisk_guide_dismiss_${teamId}`

  // 오늘 자정까지 dismiss 여부 확인
  function isHighRiskDismissedToday() {
    try {
      const until = localStorage.getItem(HIGH_RISK_DISMISS_KEY)
      return !!until && Date.now() < Number(until)
    } catch { return false }
  }

  function handleHighRiskTabClick() {
    setActiveTab('high_risk')
    if (!isHighRiskDismissedToday()) setShowHighRiskGuide(true)
  }

  function dismissHighRiskGuide(untilTomorrow: boolean) {
    if (untilTomorrow) {
      try {
        // 오늘 자정(00:00)까지
        const midnight = new Date(); midnight.setHours(24, 0, 0, 0)
        localStorage.setItem(HIGH_RISK_DISMISS_KEY, String(midnight.getTime()))
      } catch {}
    }
    setShowHighRiskGuide(false)
  }

  // 이전 작업항목 가져오기 (모달)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importItems,     setImportItems]     = useState<WorkItem[]>([])
  const [importDate,      setImportDate]      = useState<string | null>(null)
  const [importTitle,     setImportTitle]     = useState<string | null>(null)
  const [importFetching,  setImportFetching]  = useState(false)
  const [importSelected,  setImportSelected]  = useState<Set<string>>(new Set())
  const [importSaving,    setImportSaving]    = useState(false)

  // ── 초기 데이터 로드 + 임시저장 복원 ─────────────────────
  useEffect(() => {
    async function load() {
      const res  = await fetch(`/api/submit-info?teamId=${teamId}`)
      if (res.status === 404) { setLoading(false); return }
      const data = await res.json()
      if (!data.team) { setLoading(false); return }
      setTeam(data.team)
      if (!data.meeting) {
        setNoMeeting(true)
      } else {
        setMeeting(data.meeting)
      }
      setLoading(false)

      // 고위험작업 안내 팝업 — 오늘 dismiss 안 했으면 로그인 시 자동 표시
      if (!isHighRiskDismissedToday()) {
        setShowHighRiskGuide(true)
      }

      // localStorage 임시저장 복원
      try {
        const raw = localStorage.getItem(DRAFT_KEY(teamId))
        if (raw) {
          const draft = JSON.parse(raw)
          if (draft.personnel)  setPersonnel(draft.personnel)
          if (draft.workProcess) setWorkProcess(draft.workProcess)
          if (draft.equipRows)  setEquipRows(draft.equipRows)
          toast.info('임시 저장된 내용을 불러왔습니다')
        }
      } catch {}
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
  }, [teamId]) // eslint-disable-line

  // ── localStorage 자동저장 (500ms 디바운스) ───────────────
  useEffect(() => {
    setDraftSaved(false)
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY(teamId), JSON.stringify({ personnel, workProcess, equipRows }))
        setDraftSaved(true)
        // 2초 후 인디케이터 숨김
        setTimeout(() => setDraftSaved(false), 2000)
      } catch {}
    }, 500)
    return () => clearTimeout(t)
  }, [personnel, workProcess, equipRows, teamId])

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
      if (!data.previous) { toast.info('이전에 제출한 내용이 없습니다.'); setPrevLoading(false); return }
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
      toast.success('이전 제출 내용을 불러왔습니다.')
    } catch { toast.error('이전 내용을 불러오는 중 오류가 발생했습니다.') }
    setPrevLoading(false)
  }

  // ── 이전 작업항목 불러오기 핸들러 ───────────────────────────
  async function handleFetchPrevWorkItems() {
    if (!meeting) return
    setImportFetching(true)
    try {
      const res  = await fetch(`/api/previous-work-items?teamId=${teamId}&currentMeetingId=${meeting.id}`)
      const data = await res.json()
      if (!data.items || data.items.length === 0) {
        toast.info('이전 회의에 등록한 작업항목이 없습니다.')
        setImportFetching(false)
        return
      }
      setImportItems(data.items)
      setImportDate(data.meetingDate)
      setImportTitle(data.meetingTitle)
      // 기본 전체 선택
      setImportSelected(new Set(data.items.map((i: WorkItem) => i.id)))
      setShowImportModal(true)
    } catch {
      toast.error('이전 작업항목을 불러오는 중 오류가 발생했습니다.')
    }
    setImportFetching(false)
  }

  async function handleImportSelected() {
    if (!meeting || importSelected.size === 0) return
    setImportSaving(true)

    // 이미 오늘 등록된 내 작업항목 (work_name + work_type 조합)
    const existing = new Set(
      workItems
        .filter(w => w.team_id === teamId)
        .map(w => `${w.work_type}::${w.work_name}`)
    )

    const toImport = importItems.filter(i =>
      importSelected.has(i.id) &&
      !existing.has(`${i.work_type}::${i.work_name}`)   // 중복 제외
    )
    const skipped = importSelected.size - toImport.length

    let successCount = 0
    for (const item of toImport) {
      const res = await fetch('/api/work-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id:            meeting.id,
          team_id:               teamId,
          work_type:             item.work_type,
          work_name:             item.work_name,
          location:              item.location,
          worker_count:          item.worker_count,
          description:           item.description,
          risk_factors:          item.risk_factors,
          improvement_measures:  item.improvement_measures,
        }),
      })
      if (res.ok) successCount++
    }
    reloadWorkItems(meeting.id)
    setShowImportModal(false)
    setImportSaving(false)
    if (skipped > 0 && successCount === 0) {
      toast.info('이미 등록된 항목이라 추가되지 않았습니다.')
    } else if (skipped > 0) {
      toast.success(`${successCount}개 불러왔습니다. (중복 ${skipped}개 건너뜀)`)
    } else {
      toast.success(`${successCount}개 작업항목을 불러왔습니다.`)
    }
  }

  // ── 자재하역 이전 내역 불러오기 핸들러 ─────────────────────
  async function handleLoadPrevMaterial() {
    if (!meeting) return
    setPrevMaterialLoading(true)
    try {
      const res  = await fetch(`/api/previous-material-reservations?teamId=${teamId}&currentMeetingId=${meeting.id}`)
      const data = await res.json()
      if (!data.previous) {
        toast.info('이전 회의에 등록한 자재 반입 내역이 없습니다.')
        setPrevMaterialLoading(false)
        return
      }
      const prev = data.previous
      // quantity 파싱: "덤프트럭 2대" → vehicle + vehicleCount
      let vehicle = prev.vehicle_type ?? ''
      let vehicleCount = ''
      if (prev.quantity) {
        const m = (prev.quantity as string).match(/^(.+?)\s+(\d+)대$/)
        if (m) { vehicle = m[1].trim(); vehicleCount = m[2] }
      }
      setPrevMaterialData({
        desc: prev.material_description ?? '',
        vehicle,
        vehicleCount,
        unloadingLocation: prev.unloading_location ?? '',
        contactPerson:     prev.contact_person    ?? '',
      })
      setPrevMaterialLoaded(true)
      toast.success('이전 자재 내역을 불러왔습니다. GATE와 시간대를 선택해 신청하세요.')
    } catch {
      toast.error('이전 자재 내역을 불러오는 중 오류가 발생했습니다.')
    }
    setPrevMaterialLoading(false)
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
    // 지적도가 있으면 고위험 마커 필수
    if (hasMap && myHighRiskCount === 0)
      errs.markers = '고위험 지적도에 장비/작업구역을 1개 이상 표시해 주세요.'
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
      // 임시저장 삭제
      try { localStorage.removeItem(DRAFT_KEY(teamId)) } catch {}
      toast.success('자료가 성공적으로 제출되었습니다!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '오류가 발생했습니다.'
      setErrorMsg(msg)
      setStep('error')
      toast.error(`제출 실패: ${msg}`)
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
    if (res.ok) {
      reloadWorkItems(meeting.id)
      toast.success('작업항목이 추가되었습니다.')
    } else {
      toast.error('작업항목 추가에 실패했습니다.')
    }
  }

  async function deleteWorkItem(id: string) {
    const res = await fetch(`/api/work-items?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setWorkItems(prev => prev.filter(i => i.id !== id))
      toast.success('작업항목이 삭제되었습니다.')
    } else {
      toast.error('작업항목 삭제에 실패했습니다.')
    }
  }

  // ── 자재 예약 핸들러 ─────────────────────────────────────
  async function reserveSlot(slotId: string, desc: string, qty: string, vehicle: string, unloadingLocation: string, contactPerson: string) {
    const res = await fetch('/api/material-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, teamId, materialDescription: desc, quantity: qty, vehicleType: vehicle, unloadingLocation, contactPerson }),
    })
    if (!res.ok) {
      const err = await res.json()
      toast.error(err.error || '자재 예약에 실패했습니다.')
      return
    }
    toast.success('자재 하역 시간이 예약되었습니다.')
    if (meeting) reloadSlots(meeting.id)
  }

  async function cancelReservation(reservationId: string) {
    await fetch(`/api/material-slots?reservationId=${reservationId}`, { method: 'DELETE' })
  }

  // ── 마커 삭제 → 연결된 작업항목도 삭제 ───────────────────
  function handleHighRiskMarkerDelete(marker: MapMarker) {
    const linked = workItems.find(
      w => w.team_id === teamId && w.work_type === 'high_risk' && w.work_name === marker.label,
    )
    if (linked) deleteWorkItem(linked.id)
  }
  function handleGeneralMarkerDelete(marker: MapMarker) {
    const linked = workItems.find(
      w => w.team_id === teamId && w.work_type === 'general' && w.work_name === marker.label,
    )
    if (linked) deleteWorkItem(linked.id)
  }

  const isClosed = meeting?.status === 'closed'
  const hasMap   = !!meeting?.map_file_url

  // ── 회의자료 출력 ──────────────────────────────────────────
  const [exportOpen,    setExportOpen]    = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  const handleExport = useCallback(async (format: ExportFmt) => {
    if (!meeting) return
    setExportOpen(false)
    setExportLoading(true)

    const esc = (s: string) =>
      (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

    // 마커 fetch
    let pdfMarkers: MapMarkerData[] = []
    try {
      const res = await fetch(`/api/map-markers?meetingId=${meeting.id}`)
      const data = await res.json()
      if (Array.isArray(data)) pdfMarkers = (data as MapMarkerData[]).filter(m => m.work_type === 'high_risk')
    } catch { /* ignore */ }

    // 팀 컬러 맵
    const pdfColorMap: Record<string, string> = {}
    allTeams.forEach((t, idx) => { pdfColorMap[t.id] = TEAM_COLORS[idx % TEAM_COLORS.length] })

    const highRisk = workItems.filter(w => w.work_type === 'high_risk')
    const general  = workItems.filter(w => w.work_type === 'general')
    const allRes   = slots.flatMap(s => (s.material_reservations ?? []).map(r => ({ ...r, slot_time: s.slot_time, gate: s.gate })))
    const pdfMapUrl = meeting.map_file_url ?? null

    // 마커 HTML
    const mapMarkersHtml = pdfMarkers.map(m => {
      const color = pdfColorMap[m.team_id ?? ''] ?? '#6B7280'
      const icon  = MARKER_ICONS[m.marker_type] ?? '📍'
      return `<div style="position:absolute;left:${m.x_pct}%;top:${m.y_pct}%;transform:translate(-50%,-50%);z-index:10;pointer-events:none;display:flex;flex-direction:column;align-items:center;">
        <div style="width:26px;height:26px;border-radius:50%;background:${color};border:2.5px solid white;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.45);flex-shrink:0;">${icon}</div>
        ${m.label ? `<div style="font-size:7.5px;background:rgba(0,0,0,0.72);color:white;padding:1px 4px;border-radius:2px;margin-top:2px;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;line-height:1.4;">${esc(m.label)}</div>` : ''}
      </div>`
    }).join('')

    // 카드 HTML
    const cardHtml = (item: WorkItem, color: 'red' | 'blue') => {
      const metaRow = [
        item.location     ? `📍${esc(item.location)}` : '',
        item.worker_count > 0 ? `👷${item.worker_count}명` : '',
      ].filter(Boolean).join(' · ')
      return `
      <div class="card ${color}">
        <div class="card-top">
          <div class="ctitle">${esc(item.work_name)}</div>
          ${metaRow ? `<div class="cmeta">${metaRow}</div>` : ''}
          ${item.description ? `<div class="cdesc">${esc(item.description)}</div>` : ''}
        </div>
        ${item.risk_factors ? `<div class="risk"><span class="lbl">⚠ 위험요인</span>${esc(item.risk_factors)}</div>` : ''}
        ${item.improvement_measures ? `<div class="impr"><span class="lbl">✓ 개선대책</span>${esc(item.improvement_measures)}</div>` : ''}
      </div>`
    }

    const groupBy = (items: WorkItem[]) => {
      const g: Record<string, WorkItem[]> = {}
      items.forEach(item => { const n = item.teams?.name ?? '미지정'; if (!g[n]) g[n] = []; g[n].push(item) })
      return g
    }
    const renderGrouped = (grouped: Record<string, WorkItem[]>, color: 'red' | 'blue') =>
      Object.entries(grouped).map(([co, items]) =>
        `<div class="co-grp">
          <div class="co-title ${color}-co">${esc(co)} <span class="gcnt">${items.length}건</span></div>
          <div class="co-cards">${items.map(i => cardHtml(i, color)).join('')}</div>
        </div>`
      ).join('')

    const hrHtml  = highRisk.length === 0 ? '<p class="empty">등록된 고위험작업이 없습니다.</p>' : renderGrouped(groupBy(highRisk), 'red')
    const genHtml = general.length  === 0 ? '<p class="empty">등록된 일반작업이 없습니다.</p>'  : renderGrouped(groupBy(general),  'blue')

    const gates  = [...new Set(allRes.map(r => r.gate))].sort()
    const matHtml = allRes.length === 0
      ? '<p class="empty">등록된 자재 신청이 없습니다.</p>'
      : `<table><thead><tr><th>GATE</th><th>시간</th><th>업체</th><th>자재명</th><th>차량/대수</th><th>하역장소</th><th>담당자(연락처)</th></tr></thead><tbody>
         ${gates.flatMap(gate => {
           const rows = allRes.filter(r => r.gate === gate).sort((a,b) => a.slot_time.localeCompare(b.slot_time))
           return [
             `<tr><td colspan="7" class="gate-hd">${esc(gate)}</td></tr>`,
             ...rows.map(r => `<tr><td>${esc(r.gate)}</td><td class="mono">${(r.slot_time??'').slice(0,5)}</td>
               <td>${esc(r.teams?.name??'미지정')}</td><td>${esc(r.material_description??'—')}</td>
               <td>${esc(r.quantity??'—')}</td>
               <td>${esc(r.unloading_location??'—')}</td>
               <td>${esc(r.contact_person??'—')}</td></tr>`)
           ]
         }).join('')}
         </tbody></table>`

    const pageSections: string[] = []
    if (pdfMapUrl) {
      pageSections.push(
        `<div class="sec-title">🗺️ 고위험작업 지적도 <span class="badge br">${pdfMarkers.length}개소</span></div>` +
        `<div class="map-wrap"><img src="${pdfMapUrl}" alt="지적도">${mapMarkersHtml}</div>`
      )
    }
    pageSections.push(`<div class="sec-title">⚠️ 고위험 현황 <span class="badge br">${highRisk.length}건</span></div>${hrHtml}`)
    pageSections.push(`<div class="sec-title">📋 일반작업 내용 <span class="badge bb">${general.length}건</span></div>${genHtml}`)
    pageSections.push(`<div class="sec-title">🚛 자재 하역/운반 <span class="badge ba">${allRes.length}건</span></div>${matHtml}`)

    const bodyHtml = pageSections.map((sec, i) => i === 0 ? sec : `<div class="page-break">${sec}</div>`).join('\n')

    const mime    = format === 'jpg' ? 'image/jpeg' : 'image/png'
    const ext     = format
    const quality = format === 'jpg' ? ',0.92' : ''
    const fname   = `DABs_${esc(meeting.date)}.${ext}`

    const html = `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<title>DABs 회의자료_${esc(meeting.date)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 portrait;margin:14mm 16mm}
body{font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',system-ui,sans-serif;font-size:11px;color:#111;background:#fff}
.page-break{page-break-before:always;break-before:page;padding-top:0}
.pg-hd{padding:0 0 10px;border-bottom:3px solid #111;margin-bottom:14px}
.pg-title{font-size:18px;font-weight:800;letter-spacing:-.5px}
.pg-meta{font-size:9px;color:#6b7280;margin-top:4px}
.sec-title{font-size:13px;font-weight:700;margin-bottom:11px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;display:flex;align-items:center;gap:7px}
.badge{display:inline-block;padding:2px 7px;border-radius:9px;font-size:9px;font-weight:700}
.br{background:#fef2f2;color:#dc2626}.bb{background:#eff6ff;color:#2563eb}.ba{background:#fffbeb;color:#b45309}
.empty{color:#9ca3af;padding:10px 0;font-size:11px}
.map-wrap{position:relative;display:block;width:100%;line-height:0}
.map-wrap img{width:100%;height:auto;display:block}
.co-grp{margin-bottom:18px}
.co-title{font-size:12px;font-weight:800;color:#111;background:#f3f4f6;border-radius:5px;padding:5px 10px;margin-bottom:6px;display:flex;align-items:center;gap:6px;letter-spacing:-.3px;border-left:3px solid #9ca3af}
.co-title.red-co{border-left-color:#ef4444;color:#991b1b}
.co-title.blue-co{border-left-color:#3b82f6;color:#1e40af}
.gcnt{font-size:10px;color:#9ca3af;font-weight:400;margin-left:4px}
.co-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.card{border-radius:5px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;border:1px solid #e5e7eb;display:flex;flex-direction:column}
.card-top{padding:6px 9px;flex:1}
.card.red .card-top{background:#fef2f2;border-bottom:1px solid #fecaca}
.card.blue .card-top{background:#eff6ff;border-bottom:1px solid #bfdbfe}
.ctitle{font-size:10px;font-weight:700;line-height:1.35;margin-bottom:2px}
.cmeta{font-size:8px;color:#6b7280;line-height:1.3}
.cdesc{font-size:8px;color:#6b7280;margin-top:2px;line-height:1.3}
.risk{padding:3px 9px;background:#fffbeb;border-top:1px solid #fde68a;font-size:9px;color:#78350f;line-height:1.4}
.impr{padding:3px 9px;background:#f0fdf4;border-top:1px solid #bbf7d0;font-size:9px;color:#14532d;line-height:1.4}
.lbl{display:inline;font-size:8px;font-weight:700;margin-right:4px}
.risk .lbl{color:#b45309}.impr .lbl{color:#16a34a}
table{width:100%;border-collapse:collapse}
th{font-size:9px;font-weight:700;color:#6b7280;text-align:left;padding:5px 8px;border-bottom:2px solid #e5e7eb;background:#f9fafb}
td{font-size:10px;padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}
.gate-hd{font-weight:700;color:#b45309;background:#fffbeb;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a;font-size:9px;letter-spacing:.5px}
.mono{font-variant-numeric:tabular-nums;font-weight:600}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<div class="pg-hd">
  <div class="pg-title">📋 ${esc(meeting.title || 'DABs 회의 자료')}</div>
  <div class="pg-meta">회의 일자: ${esc(meeting.date)} &nbsp;·&nbsp; 출력: ${new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}</div>
</div>

${bodyHtml}

<script>${
  format === 'pdf'
    ? `window.addEventListener('load',function(){setTimeout(function(){window.print()},500)})`
    : `window.addEventListener('load',function(){
  setTimeout(function(){
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    document.head.appendChild(s);
    s.onload=function(){
      document.body.style.background='#fff';
      html2canvas(document.body,{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff',windowWidth:1100})
      .then(function(canvas){
        var a=document.createElement('a');
        a.download='${fname}';
        a.href=canvas.toDataURL('${mime}'${quality});
        a.click();
        setTimeout(function(){window.close()},800);
      });
    };
  },600);
});`
}</script>
</body></html>`

    const pw = window.open('', '_blank', 'width=1100,height=850')
    if (!pw) {
      alert('팝업이 차단되어 있습니다.\n브라우저 주소창에서 팝업을 허용한 후 다시 시도해주세요.')
      setExportLoading(false)
      return
    }
    pw.document.open()
    pw.document.write(html)
    pw.document.close()
    setExportLoading(false)
  }, [meeting, workItems, slots, allTeams])

  // ── 로딩 / 오류 상태 ─────────────────────────────────────
  if (loading) return <FullPageSpinner />
  if (!team)   return <ErrorPage message="업체 정보를 찾을 수 없습니다." />

  // 고위험 탭에서만 2컬럼 레이아웃 (일반작업은 지적도 없음)
  const showMapColumn = hasMap && activeTab === 'high_risk'

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 공지사항 팝업 ──────────────────────────────────── */}
      {showPopup && announcements[popupIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-200 flex flex-col max-h-[85vh]">
            <div className="px-8 pt-8 pb-4 shrink-0">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">공지사항</h2>
              <p className="text-xs text-gray-500">{popupIdx + 1}/{announcements.length}</p>
            </div>
            <div className="px-8 flex-1 overflow-y-auto overscroll-contain pb-2">
              <h3 className="font-medium text-gray-900 mb-2">{announcements[popupIdx].title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {announcements[popupIdx].content}
              </p>
            </div>
            <div className="px-8 pb-8 pt-4 shrink-0">
              <div className="flex gap-2">
                {popupIdx < announcements.length - 1 ? (
                  <button onClick={() => setPopupIdx(i => i + 1)}
                    className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors">
                    다음 공지
                  </button>
                ) : (
                  <button onClick={() => {
                    setShowPopup(false)
                    // 공지 확인 후 고위험작업 안내 팝업 강제 표시
                    // (localStorage dismiss 여부 무관 — 공지가 있을 때는 반드시 안내)
                    try { localStorage.removeItem(HIGH_RISK_DISMISS_KEY) } catch {}
                    setShowHighRiskGuide(true)
                  }}
                    className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors">
                    확인
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 고위험작업 안내 팝업 ───────────────────────────────── */}
      {/* 공지사항 팝업이 열려있으면 고위험 안내는 그 후에 순서대로 표시 */}
      {showHighRiskGuide && !showPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-gray-100 overflow-hidden animate-slide-up-fade">
            {/* 헤더 */}
            <div className="px-6 pt-6 pb-4" style={{ background: 'linear-gradient(135deg,#fef2f2 0%,#fff7ed 100%)' }}>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">⚠️</span>
                <h2 className="text-base font-bold text-red-800 tracking-tight">당사 지정 고위험작업</h2>
              </div>
              <p className="text-xs text-red-600/80 leading-relaxed">
                다음 작업이 포함될 경우 고위험작업으로 등록해 주세요.
              </p>
            </div>

            {/* 목록 */}
            <div className="px-6 py-4">
              <ol className="space-y-2.5">
                {[
                  '철골 및 비계 설치 / 해체',
                  '외부 작업 시 사용하는 고소작업대',
                  '달비계 / 곤돌라 작업',
                  '터널 굴착 작업',
                  '배관 압력 시험',
                  '항타기 / 항발기 / 천공기 / PRD 작업',
                  '그 외 당 현장에서 지정한 고위험작업',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                      idx < 6 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                    }`}>
                      {idx + 1}
                    </span>
                    <span className={`text-sm leading-relaxed ${idx < 6 ? 'text-gray-800' : 'text-orange-700 font-medium'}`}>
                      {item}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* 버튼 */}
            <div className="px-6 pb-6 flex flex-col gap-2">
              <button
                onClick={() => dismissHighRiskGuide(false)}
                className="btn btn-primary w-full">
                확인했습니다
              </button>
              <button
                onClick={() => dismissHighRiskGuide(true)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors py-1">
                오늘 하루 보지 않기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 이전 작업항목 가져오기 모달 ───────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-100 flex flex-col max-h-[80vh]">
            {/* 헤더 */}
            <div className="px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">이전 작업항목 가져오기</h2>
                  {importDate && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {importTitle ? `${importTitle} · ` : ''}{importDate}
                    </p>
                  )}
                </div>
                <button onClick={() => setShowImportModal(false)}
                  className="text-gray-300 hover:text-gray-500 transition-colors p-0.5 shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-gray-400">{importSelected.size}/{importItems.length}개 선택됨</span>
                <button
                  onClick={() => {
                    if (importSelected.size === importItems.length) setImportSelected(new Set())
                    else setImportSelected(new Set(importItems.map(i => i.id)))
                  }}
                  className="text-[11px] font-medium text-blue-600 hover:text-blue-700">
                  {importSelected.size === importItems.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {importItems.map(item => {
                const isSelected = importSelected.has(item.id)
                const isHighRisk = item.work_type === 'high_risk'
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      const next = new Set(importSelected)
                      if (isSelected) next.delete(item.id)
                      else next.add(item.id)
                      setImportSelected(next)
                    }}
                    className={[
                      'rounded-xl px-3.5 py-3 border cursor-pointer transition-all duration-150 select-none',
                      isSelected
                        ? isHighRisk ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
                        : 'border-gray-100 bg-gray-50 opacity-50',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* 체크박스 */}
                      <div className={[
                        'w-4 h-4 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors',
                        isSelected
                          ? isHighRisk ? 'border-red-500 bg-red-500' : 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 bg-white',
                      ].join(' ')}>
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      {/* 내용 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`badge text-[10px] ${isHighRisk ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                            {isHighRisk ? '고위험' : '일반'}
                          </span>
                          <span className="text-xs font-semibold text-gray-800">{item.work_name}</span>
                        </div>
                        <div className="flex gap-3 mt-0.5 text-[11px] text-gray-400">
                          {item.location     && <span>{item.location}</span>}
                          {item.worker_count > 0 && <span>{item.worker_count}명</span>}
                        </div>
                        {item.risk_factors && (
                          <p className="text-[11px] text-amber-700/70 mt-1 line-clamp-1">⚠ {item.risk_factors}</p>
                        )}
                        {item.improvement_measures && (
                          <p className="text-[11px] text-emerald-700/70 mt-0.5 line-clamp-1">✅ {item.improvement_measures}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 푸터 버튼 */}
            <div className="px-5 py-4 shrink-0 flex gap-2.5" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
              <button onClick={() => setShowImportModal(false)} className="btn btn-secondary flex-1">
                취소
              </button>
              <button
                onClick={handleImportSelected}
                disabled={importSaving || importSelected.size === 0}
                className="btn btn-primary flex-1">
                {importSaving ? '불러오는 중…' : `${importSelected.size}개 불러오기`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 회의자료 출력 포맷 모달 ──────────────────────────── */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setExportOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">회의자료 출력</h3>
            <p className="text-xs text-gray-400 mb-4">저장 형식을 선택하세요</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {([
                { key: 'pdf' as const, icon: '📄', label: 'PDF' },
                { key: 'png' as const, icon: '🖼️', label: 'PNG' },
                { key: 'jpg' as const, icon: '📷', label: 'JPG' },
              ]).map(({ key, icon, label }) => (
                <button key={key}
                  onClick={() => handleExport(key)}
                  className="flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 border-gray-100 hover:border-blue-400 hover:bg-blue-50 transition-all text-sm font-medium text-gray-700">
                  <span className="text-xl">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setExportOpen(false)}
              className="btn btn-secondary btn-sm w-full">취소</button>
          </div>
        </div>
      )}

      {/* ── 헤더 ───────────────────────────────────────────── */}
      <header className="bg-white/90 backdrop-blur-sm sticky top-0 z-20"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="max-w-screen-2xl mx-auto px-4 flex items-center justify-between gap-3"
          style={{ height: '3.25rem' }}>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-neutral-900 leading-tight truncate tracking-tight">{team.name}</h1>
            {meeting
              ? <p className="text-[11px] text-neutral-400 truncate">{meeting.title} · {meeting.date}</p>
              : <p className="text-[11px] text-neutral-400">DABs 자료 취합 시스템</p>
            }
          </div>
          {isClosed && (
            <span className="badge shrink-0 bg-neutral-100 text-neutral-500">마감됨</span>
          )}
          {hasMap && !isClosed && (
            <span className="shrink-0 flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-pulse" />
              실시간 공유 중
            </span>
          )}
          {meeting && (
            <button
              onClick={() => setExportOpen(true)}
              disabled={exportLoading}
              className="btn btn-ghost btn-sm shrink-0 gap-1.5"
              title="회의자료 출력">
              {exportLoading
                ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              }
              {exportLoading ? '생성 중…' : '출력'}
            </button>
          )}
          <button
            onClick={onBack}
            className="btn btn-ghost btn-sm shrink-0 gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            전환
          </button>
        </div>
      </header>

      {/* ── 메인 레이아웃 ──────────────────────────────────── */}
      <main className="max-w-screen-2xl mx-auto px-4 py-5">
        {!meeting && noMeeting ? (
          <div className="text-center py-20">
            <p className="text-gray-500">오늘 예정된 회의가 없습니다.</p>
          </div>
        ) : (
          <div className={showMapColumn
            ? 'grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6 items-start'
            : 'max-w-2xl mx-auto'
          }>

            {/* ── 왼쪽: 고위험 지적도 (XL만) ─────────────── */}
            {hasMap && activeTab === 'high_risk' && (
              <div className="hidden xl:block xl:sticky xl:top-[73px]">
                <MapAnnotator
                  meetingId={meeting!.id}
                  mapUrl={meeting!.map_file_url!}
                  myTeamId={teamId}
                  allTeamIds={allTeams.map(t => t.id)}
                  readOnly={false}
                  workType="high_risk"
                  onMarkerCountChange={count => setMyHighRiskCount(count)}
                  onMarkerDelete={handleHighRiskMarkerDelete}
                  workItems={workItems}
                  hoveredTeamId={hoveredTeamId}
                  onMarkerDropped={marker => setPendingMarkerLabel(MARKER_TYPES[marker.marker_type]?.label ?? marker.marker_type)}
                />
              </div>
            )}


            {/* ── 오른쪽: 탭 + 폼 ─────────────────────────── */}
            <div>
              {/* 탭 네비게이션 */}
              <div className="bg-white/90 flex overflow-x-auto px-4"
                style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                {([
                  { key: 'high_risk', label: '고위험작업', badge: myHighRiskCount > 0 ? `${myHighRiskCount}` : null, color: 'red' },
                  { key: 'general',   label: '일반작업',   badge: null, color: 'blue' },
                  { key: 'material',  label: '자재하역',   badge: null, color: null },
                  { key: 'submit',    label: '자료제출',   badge: null, color: null },
                ] as { key: Tab; label: string; badge: string | null; color: string | null }[]).map(t => (
                  <button key={t.key} onClick={() => t.key === 'high_risk' ? handleHighRiskTabClick() : setActiveTab(t.key)}
                    className={[
                      'flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-all duration-150',
                      activeTab === t.key
                        ? 'border-neutral-900 text-neutral-900'
                        : 'border-transparent text-neutral-400 hover:text-neutral-700',
                    ].join(' ')}>
                    {t.label}
                    {t.badge && (
                      <span className={[
                        'badge text-[9px] px-1',
                        t.color === 'red' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700',
                      ].join(' ')}>
                        {t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* 탭 콘텐츠 — hidden으로 마운트 유지 */}
              <div className="bg-white p-4 min-h-[400px]"
                style={{ border: '1px solid rgba(0,0,0,0.07)', borderTop: 'none', borderRadius: '0 0 0.75rem 0.75rem' }}>

                {/* ── 고위험작업 ─────────────────────────────── */}
                <div className={activeTab !== 'high_risk' ? 'hidden' : ''}>
                  {/* 모바일: 고위험 지적도 (XL에서는 왼쪽 컬럼으로) */}
                  {hasMap && (
                    <div className="xl:hidden mb-5">
                      <MapAnnotator
                        meetingId={meeting!.id}
                        mapUrl={meeting!.map_file_url!}
                        myTeamId={teamId}
                        allTeamIds={allTeams.map(t => t.id)}
                        readOnly={false}
                        workType="high_risk"
                        onMarkerCountChange={count => setMyHighRiskCount(count)}
                        onMarkerDelete={handleHighRiskMarkerDelete}
                        workItems={workItems}
                        hoveredTeamId={hoveredTeamId}
                        onMarkerDropped={marker => setPendingMarkerLabel(MARKER_TYPES[marker.marker_type]?.label ?? marker.marker_type)}
                      />
                    </div>
                  )}
                  {/* XL: 지적도 안내 메시지 (지도는 왼쪽) */}
                  {hasMap && (
                    <div className="hidden xl:flex items-center gap-2 mb-4 px-3 py-2 bg-red-50 rounded-lg border border-red-100">
                      <span className="text-red-400">🗺️</span>
                      <p className="text-xs text-red-600">
                        {myHighRiskCount > 0
                          ? `✓ 고위험 지적도에 ${myHighRiskCount}개 마커 등록됨 — 왼쪽에서 추가 가능`
                          : '왼쪽 고위험 지적도에 장비/작업구역을 드래그하세요'}
                      </p>
                    </div>
                  )}
                  <WorkItemTab
                    workType="high_risk" label="고위험작업" color="red"
                    isClosed={isClosed}
                    items={workItems.filter(i => i.work_type === 'high_risk')}
                    isLoading={workLoading}
                    myTeamId={teamId} myTeamName={team.name}
                    onAdd={async (data) => { await addWorkItem('high_risk', data) }}
                    onDelete={deleteWorkItem}
                    onHoverTeam={setHoveredTeamId}
                    onImportPrev={importFetching ? undefined : handleFetchPrevWorkItems}
                    importFetching={importFetching}
                    autoOpenWith={pendingMarkerLabel}
                    onAutoOpenHandled={() => setPendingMarkerLabel(null)}
                  />
                </div>

                {/* ── 일반작업 ───────────────────────────────── */}
                <div className={activeTab !== 'general' ? 'hidden' : ''}>
                  <WorkItemTab
                    workType="general" label="일반작업" color="blue"
                    isClosed={isClosed}
                    items={workItems.filter(i => i.work_type === 'general')}
                    isLoading={workLoading}
                    myTeamId={teamId} myTeamName={team.name}
                    onAdd={async (data) => { await addWorkItem('general', data) }}
                    onDelete={deleteWorkItem}
                    onImportPrev={importFetching ? undefined : handleFetchPrevWorkItems}
                    importFetching={importFetching}
                  />
                </div>

                {/* ── 자재하역/운반 ──────────────────────────── */}
                <div className={activeTab !== 'material' ? 'hidden' : ''}>
                  <MaterialTab
                    isClosed={isClosed}
                    slots={slots}
                    isLoading={slotsLoading}
                    myTeamId={teamId} myTeamName={team.name}
                    onReserve={(slotId, desc, qty, vehicle, unloadingLocation, contactPerson) =>
                      reserveSlot(slotId, desc, qty, vehicle, unloadingLocation, contactPerson)}
                    onCancel={cancelReservation}
                    prevMaterial={prevMaterialData}
                    onLoadPrevMaterial={prevMaterialLoading ? undefined : handleLoadPrevMaterial}
                    prevMaterialLoading={prevMaterialLoading}
                    prevMaterialLoaded={prevMaterialLoaded}
                  />
                </div>

                {/* ── 자료제출 ───────────────────────────────── */}
                <div className={activeTab !== 'submit' ? 'hidden' : ''}>
                  <SubmitTab
                    meeting={meeting} isClosed={isClosed}
                    hasMap={hasMap} myMarkerCount={myHighRiskCount}
                    myHighRiskCount={myHighRiskCount}
                    personnel={personnel} setPersonnel={setPersonnel}
                    workProcess={workProcess} setWorkProcess={setWorkProcess}
                    equipRows={equipRows} setEquipRows={setEquipRows}
                    file={file} setFile={setFile}
                    dragOver={dragOver} setDragOver={setDragOver}
                    errors={errors}
                    step={step} progress={progress}
                    errorMsg={errorMsg} downloadUrl={downloadUrl}
                    prevLoading={prevLoading} prevDate={prevDate} prevLoaded={prevLoaded}
                    draftSaved={draftSaved}
                    fileInputRef={fileInputRef}
                    onLoadPrevious={handleLoadPrevious}
                    onDrop={handleDrop}
                    onFileChange={f => validateAndSetFile(f)}
                    onSubmit={handleSubmit}
                    onGoToHighRisk={handleHighRiskTabClick}
                  />
                </div>
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
  meeting, isClosed, hasMap, myMarkerCount, myHighRiskCount,
  personnel, setPersonnel, workProcess, setWorkProcess,
  equipRows, setEquipRows, file, setFile,
  dragOver, setDragOver, errors, step, progress, errorMsg, downloadUrl,
  prevLoading, prevDate, prevLoaded, draftSaved, fileInputRef,
  onLoadPrevious, onDrop, onFileChange, onSubmit, onGoToHighRisk,
}: {
  meeting: Meeting | null; isClosed: boolean; hasMap: boolean; myMarkerCount: number
  myHighRiskCount: number
  personnel: Record<string, string>; setPersonnel: React.Dispatch<React.SetStateAction<{elderly:string;superElderly:string;foreign:string;female:string;diseased:string;total:string}>>
  workProcess: string; setWorkProcess: (v: string) => void
  equipRows: {type: string; count: string; isCustom: boolean}[]
  setEquipRows: (v: {type: string; count: string; isCustom: boolean}[]) => void
  file: File | null; setFile: (v: File | null) => void
  dragOver: boolean; setDragOver: (v: boolean) => void
  errors: Record<string, string>
  step: UploadStep; progress: number; errorMsg: string; downloadUrl: string
  prevLoading: boolean; prevDate: string | null; prevLoaded: boolean
  draftSaved: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onLoadPrevious: () => void; onDrop: (e: React.DragEvent) => void
  onFileChange: (f: File) => void; onSubmit: (e: React.FormEvent) => void
  onGoToHighRisk: () => void
}) {
  const equipComposingRef = useRef(false)
  if (!meeting) return (
    <div className="text-center py-20">
      <p className="text-gray-500">오늘 예정된 회의가 없습니다.</p>
    </div>
  )

  if (step === 'done') return (
    <div className="text-center py-12 animate-slide-up-fade">
      <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-neutral-900 mb-1 tracking-tight">제출 완료</h2>
      <p className="text-xs text-neutral-400 mb-5">자료가 성공적으로 업로드되었습니다.</p>
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          제출 파일 확인
        </a>
      )}
    </div>
  )

  const isUploading = step === 'uploading' || step === 'saving'

  return (
    <form onSubmit={onSubmit} className="space-y-5">

      {/* 고위험 지적도 마커 상태 */}
      {hasMap && (
        <button type="button" onClick={onGoToHighRisk}
          className={[
            'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-left transition-colors',
            myHighRiskCount > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200',
          ].join(' ')}>
          <p className={`text-sm font-medium ${myHighRiskCount > 0 ? 'text-red-800' : 'text-amber-800'}`}>
            {myHighRiskCount > 0
              ? `✓ 고위험 지적도 마커 ${myHighRiskCount}개`
              : '⚠ 고위험 지적도 마커 없음'}
          </p>
          <span className={`text-xs ${myHighRiskCount > 0 ? 'text-red-400' : 'text-amber-500'}`}>
            탭으로 이동 →
          </span>
        </button>
      )}
      {errors.markers && (
        <p className="text-xs text-red-500">{errors.markers}</p>
      )}

      {/* 이전 내용 불러오기 */}
      <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3.5 py-3"
        style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
        <div>
          <p className="text-xs font-medium text-neutral-800">이전 제출 내용 불러오기</p>
          {prevLoaded && prevDate && (
            <p className="text-[11px] text-neutral-400 mt-0.5">{prevDate} 제출 내용</p>
          )}
        </div>
        <button type="button" onClick={onLoadPrevious} disabled={prevLoading || isClosed}
          className="btn btn-primary btn-sm">
          {prevLoading ? '불러오는 중…' : '불러오기'}
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
                  onCompositionStart={() => { equipComposingRef.current = true }}
                  onCompositionEnd={e => {
                    equipComposingRef.current = false
                    const val = (e.target as HTMLInputElement).value
                    const next = [...equipRows]; next[idx] = { ...next[idx], type: val }; setEquipRows(next)
                  }}
                  onChange={e => {
                    if (!equipComposingRef.current) {
                      const next = [...equipRows]; next[idx] = { ...next[idx], type: e.target.value }; setEquipRows(next)
                    }
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
        <div className="surface p-4">
          <div className="flex justify-between text-xs mb-2.5">
            <span className="text-neutral-600 font-medium">{step === 'saving' ? '저장 중…' : '업로드 중…'}</span>
            <span className="text-neutral-900 font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="h-1 bg-neutral-100 rounded-full overflow-hidden">
            <div className="h-full bg-neutral-900 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {step === 'error' && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {/* 임시저장 인디케이터 */}
      {draftSaved && !isClosed && (
        <div className="flex items-center justify-end gap-1.5 text-xs text-gray-400">
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          임시저장됨
        </div>
      )}

      {!isClosed ? (
        <button type="submit" disabled={isUploading}
          className="btn btn-primary btn-lg w-full">
          {isUploading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                style={{ animation: 'spin 0.8s linear infinite' }} />
              {step === 'saving' ? '저장 중…' : '제출 중…'}
            </span>
          ) : '자료 제출하기'}
        </button>
      ) : (
        <div className="text-center py-4 text-neutral-400 text-xs">회의가 마감되었습니다.</div>
      )}
    </form>
  )
}

// ── 작업 항목 탭 (고위험 / 일반 공용) ─────────────────────────
function WorkItemTab({
  workType, label, color, isClosed, items, isLoading, myTeamId, myTeamName, onAdd, onDelete,
  onHoverTeam, onImportPrev, importFetching, autoOpenWith, onAutoOpenHandled,
}: {
  workType: 'high_risk' | 'general'; label: string; color: 'red' | 'blue'
  isClosed: boolean; items: WorkItem[]; isLoading: boolean
  myTeamId: string; myTeamName: string
  onAdd: (data: Partial<WorkItem>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onHoverTeam?: (teamId: string | null) => void
  onImportPrev?: () => void               // 이전 작업항목 불러오기
  importFetching?: boolean
  /** 마커 드롭 시 자동으로 폼을 열고 작업명을 채워줌 */
  autoOpenWith?: string | null
  /** 자동 오픈 처리 완료 후 부모에게 알림 */
  onAutoOpenHandled?: () => void
}) {
  const [showForm,    setShowForm]    = useState(false)
  const [workName,    setWorkName]    = useState('')
  const [location,    setLocation]    = useState('')
  const [workerCount, setWorkerCount] = useState('')
  const [description, setDescription] = useState('')
  const [riskFactors,       setRiskFactors]       = useState('')
  const [improveMeasures,   setImproveMeasures]   = useState('')
  const [saving,      setSaving]      = useState(false)

  // 마커 드롭 → 폼 자동 오픈 + 작업명 자동 입력
  useEffect(() => {
    if (autoOpenWith && !isClosed) {
      setWorkName(autoOpenWith)
      setShowForm(true)
      onAutoOpenHandled?.()
    }
  }, [autoOpenWith, isClosed, onAutoOpenHandled])

  const colorCls = color === 'red'
    ? { dot: 'bg-red-400', badge: 'bg-red-50 text-red-700', btn: 'btn-primary', border: 'rgba(0,0,0,0.08)' }
    : { dot: 'bg-blue-400', badge: 'bg-blue-50 text-blue-700', btn: 'btn-primary', border: 'rgba(0,0,0,0.08)' }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!workName.trim()) return
    setSaving(true)
    await onAdd({
      work_name: workName, location, worker_count: Number(workerCount) || 0,
      description, risk_factors: riskFactors, improvement_measures: improveMeasures,
    })
    setWorkName(''); setLocation(''); setWorkerCount('')
    setDescription(''); setRiskFactors(''); setImproveMeasures('')
    setShowForm(false); setSaving(false)
  }

  function handleCancel() {
    setShowForm(false)
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">{label} 현황</h2>
          <p className="text-xs text-gray-500 mt-0.5">모든 협력업체가 함께 등록 · 실시간 공유</p>
        </div>
        {!isClosed && (
          <button onClick={() => setShowForm(true)} className={`btn ${colorCls.btn} btn-sm shrink-0`}>
            + 작업 추가
          </button>
        )}
      </div>

      {/* ── 이전 작업항목 불러오기 카드 ─────────────────────── */}
      {!isClosed && onImportPrev && (
        <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3.5 py-3"
          style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
          <div>
            <p className="text-xs font-medium text-neutral-800">이전 작업항목 불러오기</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">이전 회의 등록 항목을 선택해서 가져올 수 있습니다</p>
          </div>
          <button onClick={onImportPrev} disabled={importFetching}
            className="btn btn-primary btn-sm shrink-0">
            {importFetching ? '조회 중…' : '불러오기'}
          </button>
        </div>
      )}

      {showForm && (
        <div className="surface p-4 animate-slide-up-fade">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
              새 {label} 등록
            </h3>
          </div>
          <form onSubmit={handleAdd} className="space-y-2.5">
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">작업명 *</label>
              <input type="text" placeholder="예) 철근 배근 작업" value={workName}
                onChange={e => setWorkName(e.target.value)}
                className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">위치/구간</label>
                <input type="text" placeholder="예) A동 3층" value={location}
                  onChange={e => setLocation(e.target.value)}
                  className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">투입 인원</label>
                <input type="number" min="0" placeholder="명" value={workerCount}
                  onChange={e => setWorkerCount(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">상세 내용</label>
              <textarea placeholder="작업 상세 내용" value={description}
                onChange={e => {
                  setDescription(e.target.value)
                  const t = e.target; t.style.height = '0px'; t.style.height = t.scrollHeight + 'px'
                }}
                className={`${inputCls} resize-none w-full`}
                style={{ minHeight: '52px', overflow: 'hidden', padding: '0.4rem 0.625rem' }} />
            </div>
            {/* ── 위험요인 & 개선대책 ── */}
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-amber-600 uppercase tracking-wider">⚠ 위험요인</label>
              <textarea placeholder="예) 굴착 작업 중 지반 붕괴 위험" value={riskFactors}
                onChange={e => {
                  setRiskFactors(e.target.value)
                  const t = e.target; t.style.height = '0px'; t.style.height = t.scrollHeight + 'px'
                }}
                className="w-full border border-amber-200 rounded-md px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-300 resize-none bg-amber-50/40"
                style={{ minHeight: '52px', overflow: 'hidden' }} />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-medium text-emerald-600 uppercase tracking-wider">✅ 개선대책</label>
              <textarea placeholder="예) 흙막이 설치 및 안전망 설치 확인" value={improveMeasures}
                onChange={e => {
                  setImproveMeasures(e.target.value)
                  const t = e.target; t.style.height = '0px'; t.style.height = t.scrollHeight + 'px'
                }}
                className="w-full border border-emerald-200 rounded-md px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-300 resize-none bg-emerald-50/40"
                style={{ minHeight: '52px', overflow: 'hidden' }} />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={handleCancel} className="btn btn-secondary flex-1">취소</button>
              <button type="submit" disabled={saving} className={`btn ${colorCls.btn} flex-1`}>
                {saving ? '저장 중…' : '등록'}
              </button>
            </div>
          </form>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-xs text-neutral-400">등록된 {label}이 없습니다.</p>
          <p className="text-[11px] text-neutral-300 mt-1">다른 업체가 등록하면 실시간으로 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="rounded-lg bg-white group transition-all duration-150 hover:bg-neutral-50/60 cursor-default"
              style={{ border: `1px solid ${colorCls.border}`, padding: '0.75rem 1rem' }}
              onMouseEnter={() => onHoverTeam?.(item.team_id)}
              onMouseLeave={() => onHoverTeam?.(null)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`w-1.5 h-1.5 rounded-full ${colorCls.dot} shrink-0`} />
                    <h3 className="text-xs font-semibold text-neutral-800 tracking-tight">{item.work_name}</h3>
                    <span className={`badge ${colorCls.badge}`}>{item.teams?.name ?? '미지정'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2.5 text-[11px] text-neutral-500">
                    {item.location && <span>{item.location}</span>}
                    {item.worker_count > 0 && <span>{item.worker_count}명</span>}
                  </div>
                  {item.description && <p className="text-[11px] text-neutral-400 mt-1">{item.description}</p>}
                  {item.risk_factors && (
                    <div className="mt-1.5 flex gap-1.5">
                      <span className="text-[10px] font-medium text-amber-600 shrink-0 mt-0.5">⚠</span>
                      <p className="text-[11px] text-amber-700/80">{item.risk_factors}</p>
                    </div>
                  )}
                  {item.improvement_measures && (
                    <div className="mt-1 flex gap-1.5">
                      <span className="text-[10px] font-medium text-emerald-600 shrink-0 mt-0.5">✅</span>
                      <p className="text-[11px] text-emerald-700/80">{item.improvement_measures}</p>
                    </div>
                  )}
                </div>
                {item.team_id === myTeamId && !isClosed && (
                  <button onClick={() => onDelete(item.id)}
                    className="text-neutral-300 hover:text-red-400 transition-colors duration-150 p-1 opacity-0 group-hover:opacity-100">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
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

// ── 자재 하역/운반 탭 (GATE 선택 → 시간 선택) ─────────────────
function MaterialTab({
  isClosed, slots, isLoading, myTeamId, myTeamName, onReserve, onCancel,
  prevMaterial, onLoadPrevMaterial, prevMaterialLoading, prevMaterialLoaded,
}: {
  isClosed: boolean; slots: MaterialSlot[]; isLoading: boolean
  myTeamId: string; myTeamName: string
  onReserve: (slotId: string, desc: string, qty: string, vehicle: string, unloadingLocation: string, contactPerson: string) => Promise<void>
  onCancel: (reservationId: string) => Promise<void>
  /** 이전 자재 내역 (불러왔을 때 폼 자동 입력) */
  prevMaterial?: { desc: string; vehicle: string; vehicleCount: string; unloadingLocation: string; contactPerson: string } | null
  onLoadPrevMaterial?: () => void
  prevMaterialLoading?: boolean
  prevMaterialLoaded?: boolean
}) {
  const [selectedGate,      setSelectedGate]      = useState<string | null>(null)
  const [openSlotId,        setOpenSlotId]        = useState<string | null>(null)
  const [desc,              setDesc]              = useState('')
  const [qty,               setQty]               = useState('')
  const [vehicle,           setVehicle]           = useState('')
  const [vehicleCount,      setVehicleCount]      = useState('')
  const [unloadingLocation, setUnloadingLocation] = useState('')
  const [contactPerson,     setContactPerson]     = useState('')
  const [submitting,        setSubmitting]        = useState(false)
  const matComposingRef = useRef(false)

  // 이전 자재 내역 불러왔을 때 폼 자동 입력
  useEffect(() => {
    if (prevMaterial) {
      setDesc(prevMaterial.desc)
      setVehicle(prevMaterial.vehicle)
      setVehicleCount(prevMaterial.vehicleCount)
      setUnloadingLocation(prevMaterial.unloadingLocation)
      setContactPerson(prevMaterial.contactPerson)
    }
  }, [prevMaterial])

  if (isLoading) return <LoadingSpinner />

  const gates     = [...new Set(slots.map(s => s.gate))].sort()
  const gateSlots = selectedGate ? slots.filter(s => s.gate === selectedGate) : []

  const myResByGate = gates.reduce<Record<string, MaterialReservation | undefined>>((acc, gate) => {
    const gSlots = slots.filter(s => s.gate === gate)
    acc[gate] = gSlots.flatMap(s => s.material_reservations).find(r => r.team_id === myTeamId)
    return acc
  }, {})

  function resetForm() {
    setDesc(''); setQty(''); setVehicle(''); setVehicleCount('')
    setUnloadingLocation(''); setContactPerson('')
  }

  async function handleReserve(slotId: string) {
    if (!desc.trim()) { toast.error('자재명을 입력해주세요'); return }
    setSubmitting(true)
    // 차량/대수를 "차량종류 N대" 형태로 qty에 합산
    const vehicleStr = vehicle
      ? vehicleCount ? `${vehicle} ${vehicleCount}대` : vehicle
      : vehicleCount ? `${vehicleCount}대` : ''
    await onReserve(slotId, desc, vehicleStr, vehicle, unloadingLocation, contactPerson)
    setOpenSlotId(null)
    resetForm()
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-800 tracking-tight">자재 반입 / 반출 현황</h2>
        <p className="text-xs text-neutral-400 mt-0.5">GATE를 선택한 후 시간대를 신청하세요 · 시간대당 최대 5개 업체</p>
      </div>

      {/* ── 이전 자재 내역 불러오기 카드 ──────────────────────── */}
      {!isClosed && onLoadPrevMaterial && (
        <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3.5 py-3"
          style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
          <div>
            <p className="text-xs font-medium text-neutral-800">이전 자재 반입 내역 불러오기</p>
            {prevMaterialLoaded
              ? <p className="text-[11px] text-emerald-600 mt-0.5">✓ 불러옴 — GATE·시간대를 선택하면 자동 입력됩니다</p>
              : <p className="text-[11px] text-neutral-400 mt-0.5">이전 회의 자재명·차량·하역장소를 폼에 자동 입력합니다</p>
            }
          </div>
          <button onClick={onLoadPrevMaterial} disabled={prevMaterialLoading}
            className="btn btn-primary btn-sm shrink-0">
            {prevMaterialLoading ? '조회 중…' : prevMaterialLoaded ? '다시 불러오기' : '불러오기'}
          </button>
        </div>
      )}

      {!selectedGate ? (
        <div className="grid grid-cols-2 gap-2.5">
          {gates.map(gate => {
            const gSlots   = slots.filter(s => s.gate === gate)
            const totalRes = gSlots.reduce((acc, s) => acc + s.material_reservations.length, 0)
            const myRes    = myResByGate[gate]
            return (
              <button
                key={gate}
                onClick={() => setSelectedGate(gate)}
                className="surface flex flex-col gap-2 p-4 text-left transition-all duration-150 hover:bg-neutral-50"
                style={myRes ? { borderColor: 'rgba(52,211,153,0.5)', background: 'rgba(236,253,245,0.6)' } : {}}
              >
                <div className="flex items-center justify-between">
                  <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                  </svg>
                  {myRes && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-800 tracking-tight">{gate}</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{totalRes}건 신청됨</p>
                  {myRes && <p className="text-[11px] text-emerald-600 font-medium mt-1">내 신청 있음</p>}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => { setSelectedGate(null); setOpenSlotId(null); resetForm() }}
            className="btn btn-ghost btn-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            GATE 선택으로 돌아가기
          </button>

          <div className="surface px-4 py-3 flex items-center gap-3"
            style={{ background: '#18181b', borderColor: 'transparent' }}>
            <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
            </svg>
            <div>
              <p className="text-xs font-semibold text-white tracking-tight">{selectedGate}</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">시간대를 선택하여 신청하세요</p>
            </div>
          </div>

          <div className="space-y-2">
            {gateSlots.map(slot => {
              const reservations = slot.material_reservations ?? []
              const count  = reservations.length
              const isFull = count >= slot.max_teams
              const myRes  = reservations.find(r => r.team_id === myTeamId)
              const isOpen = openSlotId === slot.id

              return (
                <div key={slot.id} className="surface overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-neutral-800 tracking-tight">{slot.slot_time}</span>
                      <div className="flex gap-0.5">
                        {Array.from({ length: slot.max_teams }).map((_, i) => (
                          <div key={i} className={['w-1.5 h-1.5 rounded-full', i < count ? 'bg-emerald-400' : 'bg-neutral-200'].join(' ')} />
                        ))}
                      </div>
                      <span className="text-[11px] text-neutral-400">{count}/{slot.max_teams}</span>
                    </div>
                    {isFull ? (
                      <span className="badge bg-neutral-100 text-neutral-500">마감</span>
                    ) : myRes ? (
                      <button onClick={() => onCancel(myRes.id)}
                        className="text-[11px] font-medium text-red-500 hover:text-red-600 transition-colors duration-150">신청취소</button>
                    ) : !isClosed ? (
                      <button onClick={() => { setOpenSlotId(isOpen ? null : slot.id); if (isOpen) resetForm() }}
                        className={`btn btn-sm ${isOpen ? 'btn-secondary' : 'btn-primary'}`}>
                        {isOpen ? '닫기' : '신청'}
                      </button>
                    ) : null}
                  </div>

                  {/* ── 신청 폼 ── */}
                  {isOpen && !myRes && !isFull && (
                    <div className="space-y-3 px-4 py-4"
                      style={{ borderTop: '1px solid rgba(0,0,0,0.06)', background: '#fafafa' }}>

                      {/* 업체명 (자동) */}
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-100">
                        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest shrink-0">업체명</span>
                        <span className="text-xs font-medium text-neutral-700">{myTeamName}</span>
                      </div>

                      {/* 자재명 */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
                          자재명 <span className="text-red-400">*</span>
                        </label>
                        <input type="text" placeholder="예) 철근, 레미콘, 거푸집"
                          value={desc}
                          onCompositionStart={() => { matComposingRef.current = true }}
                          onCompositionEnd={e => { matComposingRef.current = false; setDesc((e.target as HTMLInputElement).value) }}
                          onChange={e => { if (!matComposingRef.current) setDesc(e.target.value) }}
                          className={inputCls} />
                      </div>

                      {/* 차량 종류 / 대수 */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">차량 종류</label>
                          <select value={vehicle} onChange={e => setVehicle(e.target.value)} className={`${inputCls} select`}>
                            <option value="">선택</option>
                            {VEHICLE_LIST.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">대수</label>
                          <input type="number" min="1" placeholder="대" value={vehicleCount}
                            onChange={e => setVehicleCount(e.target.value)}
                            className={inputCls} />
                        </div>
                      </div>

                      {/* 하역 장소 */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">하역 장소</label>
                        <input type="text" placeholder="예) A동 앞 적치장"
                          value={unloadingLocation}
                          onCompositionStart={() => { matComposingRef.current = true }}
                          onCompositionEnd={e => { matComposingRef.current = false; setUnloadingLocation((e.target as HTMLInputElement).value) }}
                          onChange={e => { if (!matComposingRef.current) setUnloadingLocation(e.target.value) }}
                          className={inputCls} />
                      </div>

                      {/* 하역물 담당자 (연락처) */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">담당자 (연락처)</label>
                        <input type="text" placeholder="예) 홍길동 010-1234-5678"
                          value={contactPerson}
                          onCompositionStart={() => { matComposingRef.current = true }}
                          onCompositionEnd={e => { matComposingRef.current = false; setContactPerson((e.target as HTMLInputElement).value) }}
                          onChange={e => { if (!matComposingRef.current) setContactPerson(e.target.value) }}
                          className={inputCls} />
                      </div>

                      <button onClick={() => handleReserve(slot.id)} disabled={submitting}
                        className="btn btn-primary btn-lg w-full">
                        {submitting
                          ? <><span className="w-3.5 h-3.5 border-[2px] border-white/30 border-t-white rounded-full"
                              style={{ animation: 'spin 0.7s linear infinite' }} />신청 중...</>
                          : '신청하기'}
                      </button>
                    </div>
                  )}

                  {/* ── 예약 목록 ── */}
                  {reservations.length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      {reservations.map((r, idx) => (
                        <div key={r.id} className={[
                          'px-4 py-2.5 text-[11px]',
                          idx > 0 ? 'border-t border-neutral-100/80' : '',
                          r.team_id === myTeamId ? 'bg-emerald-50/60' : '',
                        ].join(' ')}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.team_id === myTeamId ? 'bg-emerald-400' : 'bg-neutral-300'}`} />
                            <span className="font-semibold text-neutral-700">{r.teams?.name ?? '업체'}</span>
                            {r.material_description && <span className="text-neutral-500">· {r.material_description}</span>}
                            {r.team_id === myTeamId && (
                              <span className="ml-auto badge bg-emerald-50 text-emerald-700 shrink-0">내 신청</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-3.5 text-neutral-400">
                            {r.quantity      && <span>🚛 {r.quantity}</span>}
                            {r.unloading_location && <span>📍 {r.unloading_location}</span>}
                            {r.contact_person     && <span>📞 {r.contact_person}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-100">
        <h2 className="text-xs font-semibold text-neutral-700 tracking-tight uppercase">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-[2.5px] border-neutral-200 border-t-neutral-700 rounded-full"
        style={{ animation: 'spin 0.8s linear infinite' }} />
    </div>
  )
}

function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="w-7 h-7 border-[2.5px] border-neutral-200 border-t-neutral-700 rounded-full"
        style={{ animation: 'spin 0.8s linear infinite' }} />
    </div>
  )
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <p className="text-sm text-neutral-500">{message}</p>
    </div>
  )
}

// inputCls delegates to .input in globals.css (h-9 slim, hairline border)
const inputCls = 'input'


