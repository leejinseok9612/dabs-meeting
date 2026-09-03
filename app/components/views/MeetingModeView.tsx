// ============================================================
// app/components/views/MeetingModeView.tsx
// DABs 회의 모드 — 전체화면 슬라이드쇼 + 기상청 날씨 + 메모 패널
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import MapAnnotator from '@/app/components/MapAnnotator'
import type { WorkItemInfo } from '@/app/components/MapAnnotator'

// ── 타입 ─────────────────────────────────────────────────────
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
interface Meeting {
  id: string; title: string; date: string; status: 'open' | 'closed'
  map_file_url?: string | null
}
interface WeatherData {
  sky: number | null; pty: number | null; wsd: number | null; tmp: number | null
  skyLabel: string; ptyLabel: string
  windWarning: boolean; windCaution: boolean
  isMock: boolean; error?: string
}

// ── 슬라이드 정의 ─────────────────────────────────────────────
type SlideType = 'map_high_risk' | 'map_general' | 'work_high_risk' | 'work_general'
const SLIDES: { type: SlideType; label: string; icon: string }[] = [
  { type: 'map_high_risk',  label: '고위험 지적도',   icon: '🗺' },
  { type: 'map_general',    label: '일반 지적도',     icon: '📍' },
  { type: 'work_high_risk', label: '고위험작업 내용', icon: '⚠️' },
  { type: 'work_general',   label: '일반작업 내용',   icon: '📋' },
]

// ── 메모 로컬스토리지 키 ─────────────────────────────────────
const noteKey = (meetingId: string, slideIdx: number) =>
  `dabs_note_${meetingId}_${slideIdx}`

// ── 날씨 아이콘 ──────────────────────────────────────────────
function skyIcon(sky: number | null, pty: number | null): string {
  if (pty && pty > 0) {
    if (pty === 3) return '❄️'
    return '🌧'
  }
  if (sky === 1) return '☀️'
  if (sky === 3) return '⛅'
  if (sky === 4) return '☁️'
  return '🌤'
}

// ────────────────────────────────────────────────────────────
// WeatherWidget
// ────────────────────────────────────────────────────────────
function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null)

  useEffect(() => {
    fetch('/api/weather')
      .then(r => r.json())
      .then(setWeather)
      .catch(() => {})
  }, [])

  if (!weather) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10">
        <div className="w-16 h-3 skeleton opacity-50" />
      </div>
    )
  }

  const windLevel = weather.windWarning ? 'red' : weather.windCaution ? 'amber' : 'normal'

  return (
    <div className="flex items-center gap-2.5">
      {/* 날씨 */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm">
        <span className="text-base leading-none">{skyIcon(weather.sky, weather.pty)}</span>
        <div className="flex flex-col">
          <span className="text-[11px] font-medium text-white/90 leading-tight">
            {weather.ptyLabel || weather.skyLabel}
          </span>
          {weather.tmp !== null && (
            <span className="text-[10px] text-white/60 leading-tight">
              {weather.tmp.toFixed(1)}°C
            </span>
          )}
        </div>
        {weather.isMock && (
          <span className="text-[9px] text-white/30 ml-0.5">mock</span>
        )}
      </div>

      {/* 풍속 */}
      {weather.wsd !== null && (
        <div className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg backdrop-blur-sm',
          windLevel === 'red'    ? 'bg-red-500/80 animate-pulse'  :
          windLevel === 'amber'  ? 'bg-amber-500/80'              :
          'bg-white/10',
        ].join(' ')}>
          <span className="text-sm leading-none">💨</span>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-white leading-tight">
              {weather.wsd.toFixed(1)} m/s
            </span>
            {windLevel !== 'normal' && (
              <span className="text-[10px] font-medium text-white/90 leading-tight">
                {windLevel === 'red' ? '⚠ 작업중단 기준!' : '⚠ 주의 기준 초과'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// WorkItemSlide — 작업항목 목록 슬라이드
// ────────────────────────────────────────────────────────────
function WorkItemSlide({
  items, type,
}: {
  items: WorkItem[]
  type: 'high_risk' | 'general'
}) {
  const color = type === 'high_risk' ? 'red' : 'blue'
  const label = type === 'high_risk' ? '고위험작업' : '일반작업'

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className="text-xl font-medium text-white/60">등록된 {label}이 없습니다.</p>
      </div>
    )
  }

  // 업체별 그룹
  const grouped: Record<string, WorkItem[]> = {}
  items.forEach(item => {
    const name = item.teams?.name ?? '미지정'
    if (!grouped[name]) grouped[name] = []
    grouped[name].push(item)
  })

  return (
    <div className="h-full overflow-y-auto px-2 py-1 space-y-4 scrollbar-hide">
      {Object.entries(grouped).map(([company, compItems]) => (
        <div key={company}>
          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-neutral-900/80 backdrop-blur-sm py-1 px-2 rounded-md -mx-2">
            <span className={`w-2 h-2 rounded-full ${color === 'red' ? 'bg-red-400' : 'bg-blue-400'}`} />
            <h3 className="text-sm font-semibold text-white/90">{company}</h3>
            <span className="text-xs text-white/40 ml-auto">{compItems.length}건</span>
          </div>
          <div className="space-y-2 pl-3">
            {compItems.map(item => (
              <div key={item.id}
                className={[
                  'rounded-xl p-4',
                  color === 'red'
                    ? 'bg-red-950/40 border border-red-800/30'
                    : 'bg-blue-950/40 border border-blue-800/30',
                ].join(' ')}>
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h4 className="text-base font-semibold text-white leading-snug">{item.work_name}</h4>
                  <div className="flex gap-3 text-sm text-white/50 shrink-0">
                    {item.location && <span>📍 {item.location}</span>}
                    {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                  </div>
                </div>
                {item.description && (
                  <p className="text-sm text-white/60 mb-2">{item.description}</p>
                )}
                <div className="space-y-1.5">
                  {item.risk_factors && (
                    <div className="flex gap-2 bg-amber-950/50 border border-amber-800/30 rounded-lg px-3 py-2">
                      <span className="text-amber-400 text-sm shrink-0">⚠</span>
                      <div>
                        <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider mb-0.5">위험요인</p>
                        <p className="text-sm text-amber-200/80">{item.risk_factors}</p>
                      </div>
                    </div>
                  )}
                  {item.improvement_measures && (
                    <div className="flex gap-2 bg-emerald-950/50 border border-emerald-800/30 rounded-lg px-3 py-2">
                      <span className="text-emerald-400 text-sm shrink-0">✅</span>
                      <div>
                        <p className="text-[10px] font-semibold text-emerald-400/80 uppercase tracking-wider mb-0.5">개선대책</p>
                        <p className="text-sm text-emerald-200/80">{item.improvement_measures}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// MapSlide — 지적도 슬라이드
// ────────────────────────────────────────────────────────────
function MapSlide({
  meetingId, mapUrl, workItems, workType, allTeamIds,
}: {
  meetingId: string
  mapUrl: string
  workItems: WorkItem[]
  workType: 'high_risk' | 'general'
  allTeamIds: string[]
}) {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="w-full h-full max-w-4xl mx-auto rounded-xl overflow-hidden bg-neutral-800">
        <MapAnnotator
          meetingId={meetingId}
          mapUrl={mapUrl}
          myTeamId=""
          allTeamIds={allTeamIds}
          readOnly={true}
          workType={workType}
          workItems={workItems as unknown as WorkItemInfo[]}
        />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// NotePanel — 슬라이드별 오버레이 메모 패널
// ────────────────────────────────────────────────────────────
function NotePanel({
  meetingId, slideIdx, onClose,
}: {
  meetingId: string
  slideIdx: number
  onClose: () => void
}) {
  const key = noteKey(meetingId, slideIdx)
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(key) ?? '' } catch { return '' }
  })
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 슬라이드 변경 시 메모 내용 교체
  useEffect(() => {
    try { setText(localStorage.getItem(noteKey(meetingId, slideIdx)) ?? '') } catch {}
  }, [meetingId, slideIdx])

  const handleChange = (val: string) => {
    setText(val)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(key, val); setSaved(true) } catch {}
      setTimeout(() => setSaved(false), 1500)
    }, 500)
  }

  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-neutral-900/95 backdrop-blur-xl border-l border-white/10 flex flex-col z-30 shadow-2xl">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div>
          <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest">슬라이드 메모</p>
          <p className="text-xs text-white/70 mt-0.5">SLIDE {slideIdx + 1} — {SLIDES[slideIdx]?.label}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-[10px] text-emerald-400">저장됨 ✓</span>
          )}
          <button onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {/* 메모 입력 */}
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="이 슬라이드 관련 메모를 작성하세요.&#10;자동 저장됩니다."
        className="flex-1 resize-none bg-transparent text-sm text-white/80 placeholder-white/20 px-4 py-3 outline-none leading-relaxed"
      />
      {/* 하단 힌트 */}
      <div className="px-4 py-2 border-t border-white/10 shrink-0">
        <p className="text-[10px] text-white/25">
          입력 후 자동 저장 · 브라우저 로컬에 보관
        </p>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// MeetingModeView — 메인 컴포넌트
// ────────────────────────────────────────────────────────────
export function MeetingModeView({
  meetingId, onClose,
}: {
  meetingId: string
  onClose: () => void
}) {
  const [meeting,    setMeeting]    = useState<Meeting | null>(null)
  const [workItems,  setWorkItems]  = useState<WorkItem[]>([])
  const [allTeamIds, setAllTeamIds] = useState<string[]>([])
  const [loading,    setLoading]    = useState(true)

  const [slideIdx,   setSlideIdx]   = useState(0)
  const [showNote,   setShowNote]   = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // ── 데이터 로드 ───────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`/api/meeting-info?meetingId=${meetingId}`).then(r => r.json()).catch(() => null),
      fetch(`/api/work-items?meetingId=${meetingId}`).then(r => r.json()).catch(() => []),
      fetch('/api/teams').then(r => r.json()).catch(() => []),
    ]).then(([mtgData, wiData, teamsData]) => {
      if (mtgData?.meeting) setMeeting(mtgData.meeting)
      if (Array.isArray(wiData)) setWorkItems(wiData)
      if (Array.isArray(teamsData)) setAllTeamIds(teamsData.map((t: {id:string}) => t.id))
      setLoading(false)
    })
  }, [meetingId])

  // ── 키보드 네비게이션 ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setSlideIdx(i => Math.min(i + 1, SLIDES.length - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setSlideIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Escape') {
        if (showNote) { setShowNote(false) }
        else if (isFullscreen) { document.exitFullscreen?.() }
        else { onClose() }
      } else if (e.key === 'm' || e.key === 'M') {
        setShowNote(s => !s)
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showNote, isFullscreen, onClose]) // eslint-disable-line

  // ── 전체화면 ─────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const currentSlide = SLIDES[slideIdx]
  const highRiskItems = useMemo(() => workItems.filter(w => w.work_type === 'high_risk'), [workItems])
  const generalItems  = useMemo(() => workItems.filter(w => w.work_type === 'general'),  [workItems])
  const mapUrl = meeting?.map_file_url ?? null

  if (loading) {
    return (
      <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center z-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/40 text-sm">회의 데이터 로딩 중…</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef}
      className="fixed inset-0 bg-neutral-950 flex flex-col z-50 select-none"
      style={{ fontFamily: 'var(--font-geist-sans, system-ui)' }}>

      {/* ── 헤더 ───────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>

        {/* 왼쪽: 닫기 + 타이틀 */}
        <div className="flex items-center gap-3">
          <button onClick={onClose}
            className="flex items-center gap-1.5 text-white/50 hover:text-white/90 transition-colors text-sm font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            닫기
          </button>
          <div className="w-px h-4 bg-white/10" />
          <div>
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
              DABs 회의 모드
            </p>
            <h1 className="text-sm font-semibold text-white/90 leading-tight">
              {meeting?.title ?? meetingId}
            </h1>
          </div>
        </div>

        {/* 오른쪽: 날씨 + 메모 + 전체화면 */}
        <div className="flex items-center gap-3">
          <WeatherWidget />
          <div className="w-px h-5 bg-white/10" />
          <button
            onClick={() => setShowNote(s => !s)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              showNote
                ? 'bg-white/20 text-white'
                : 'text-white/50 hover:text-white/80 hover:bg-white/10',
            ].join(' ')}
            title="메모 (M)">
            📝 메모
          </button>
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
            title="전체화면 (F)">
            {isFullscreen ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── 슬라이드 본문 ───────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* 슬라이드 영역 */}
        <div className={['absolute inset-0 flex flex-col transition-[right] duration-300', showNote ? 'right-80' : 'right-0'].join(' ')}>

          {/* 슬라이드 타이틀 */}
          <div className="shrink-0 flex items-center justify-between px-8 pt-5 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{currentSlide.icon}</span>
              <h2 className="text-xl font-bold text-white/90">{currentSlide.label}</h2>
            </div>
            <div className="flex items-center gap-2 text-white/30 text-sm">
              <span>{slideIdx + 1}</span>
              <span>/</span>
              <span>{SLIDES.length}</span>
            </div>
          </div>

          {/* 슬라이드 콘텐츠 */}
          <div className="flex-1 overflow-hidden px-8 pb-4">
            {currentSlide.type === 'map_high_risk' && mapUrl ? (
              <MapSlide meetingId={meetingId} mapUrl={mapUrl} workItems={highRiskItems}
                workType="high_risk" allTeamIds={allTeamIds} />
            ) : currentSlide.type === 'map_general' && mapUrl ? (
              <MapSlide meetingId={meetingId} mapUrl={mapUrl} workItems={generalItems}
                workType="general" allTeamIds={allTeamIds} />
            ) : currentSlide.type === 'work_high_risk' ? (
              <WorkItemSlide items={highRiskItems} type="high_risk" />
            ) : currentSlide.type === 'work_general' ? (
              <WorkItemSlide items={generalItems} type="general" />
            ) : (
              // 지도 없을 때 fallback
              <div className="h-full flex flex-col items-center justify-center text-center">
                <p className="text-5xl mb-4">🗺</p>
                <p className="text-xl font-medium text-white/50">지도 파일이 없습니다.</p>
                <p className="text-sm text-white/30 mt-1">관리자 대시보드에서 지도를 업로드해 주세요.</p>
              </div>
            )}
          </div>

          {/* 좌우 화살표 */}
          {slideIdx > 0 && (
            <button onClick={() => setSlideIdx(i => i - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {slideIdx < SLIDES.length - 1 && (
            <button onClick={() => setSlideIdx(i => i + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
              style={{ right: showNote ? 'calc(20rem + 0.75rem)' : '0.75rem' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>

        {/* 메모 패널 */}
        {showNote && (
          <NotePanel meetingId={meetingId} slideIdx={slideIdx} onClose={() => setShowNote(false)} />
        )}
      </div>

      {/* ── 하단 슬라이드 탭 바 ─────────────────────────────── */}
      <footer className="shrink-0 flex items-center gap-2 px-5 py-3 overflow-x-auto"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {SLIDES.map((slide, idx) => (
          <button key={slide.type}
            onClick={() => setSlideIdx(idx)}
            className={[
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150',
              idx === slideIdx
                ? 'bg-white text-neutral-900'
                : 'text-white/50 hover:text-white/80 hover:bg-white/10',
            ].join(' ')}>
            <span>{slide.icon}</span>
            <span>{slide.label}</span>
          </button>
        ))}
        <div className="ml-auto text-[11px] text-white/20 shrink-0">
          ← → 키보드 이동 · M 메모 · F 전체화면 · Esc 닫기
        </div>
      </footer>
    </div>
  )
}
