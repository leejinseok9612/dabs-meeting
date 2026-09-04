// ============================================================
// app/components/views/MeetingModeView.tsx
// DABs 회의 모드 — 전체화면 슬라이드쇼 + 기상청 날씨 + 메모 패널
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback, useMemo, createContext, useContext } from 'react'

// ── 테마 컨텍스트 ─────────────────────────────────────────
type Theme = 'dark' | 'light'
const ThemeCtx = createContext<Theme>('dark')
const useTheme = () => useContext(ThemeCtx)

// ── 팀 색상 ───────────────────────────────────────────────
const TEAM_COLORS = ['#3B82F6','#F97316','#22C55E','#8B5CF6','#EF4444','#EC4899']

// ── 마커 아이콘 ───────────────────────────────────────────
const MARKER_ICONS: Record<string, string> = {
  excavator: '🚜', small_exc: '🔧', crane: '🏗️', dump_truck: '🚛',
  pump_car: '🚰', roller: '🛞', pile_driver: '⚙️', loader: '🔄',
  forklift: '🏋️', work_zone: '⚠️', personnel: '👷', material: '📦',
}

// ── 타입 ─────────────────────────────────────────────────
interface MapMarkerData {
  id: string; team_id: string | null; marker_type: string
  x_pct: number; y_pct: number; label?: string
  work_type?: string | null; teams?: { id: string; name: string }
}
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

// ── 섹션 정의 ─────────────────────────────────────────────
type SectionType = 'high_risk' | 'work_general' | 'material'
const SECTIONS: { type: SectionType; label: string; icon: string }[] = [
  { type: 'high_risk',    label: '고위험 현황',     icon: '⚠️' },
  { type: 'work_general', label: '일반작업 내용',   icon: '📋' },
  { type: 'material',     label: '자재 하역/운반',  icon: '🚛' },
]

const noteKey = (meetingId: string) => `dabs_note_${meetingId}`

// ── CDN 스크립트 로더 (html2canvas / jsPDF) ───────────────
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const el = document.createElement('script')
    el.src = src
    el.onload = () => resolve()
    el.onerror = reject
    document.head.appendChild(el)
  })
}

function weatherIcon(pty: number | null): string {
  if (!pty || pty === 0) return '🌤'
  if (pty === 3) return '❄️'
  return '🌧'
}

// ────────────────────────────────────────────────────────
// WeatherWidget
// ────────────────────────────────────────────────────────
function WeatherWidget() {
  const theme = useTheme()
  const dk = theme === 'dark'
  const [weather, setWeather] = useState<WeatherData | null>(null)

  useEffect(() => {
    fetch('/api/weather').then(r => r.json()).then(setWeather).catch(() => {})
  }, [])

  if (!weather) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${dk ? 'bg-white/10' : 'bg-black/8'}`}>
        <div className={`w-20 h-4 rounded animate-pulse ${dk ? 'bg-white/20' : 'bg-black/10'}`} />
      </div>
    )
  }

  const windLevel = weather.windWarning ? 'red' : weather.windCaution ? 'amber' : 'normal'

  return (
    <div className="flex items-center gap-2">
      {/* 기온 */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm ${dk ? 'bg-white/10' : 'bg-black/6'}`}>
        <span className="text-lg leading-none">{weatherIcon(weather.pty)}</span>
        {weather.tmp !== null ? (
          <span className={`text-base font-bold tabular-nums ${dk ? 'text-white' : 'text-gray-900'}`}>
            {weather.tmp.toFixed(1)}°C
          </span>
        ) : (
          <span className={dk ? 'text-white/40' : 'text-gray-400'}>—°C</span>
        )}
        {weather.isMock && <span className={`text-[9px] ml-1 ${dk ? 'text-white/30' : 'text-gray-300'}`}>mock</span>}
      </div>

      {/* 풍속 */}
      <div className={[
        'flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm',
        windLevel === 'red'   ? 'bg-red-500/80 animate-pulse' :
        windLevel === 'amber' ? 'bg-amber-500/80'             :
        dk ? 'bg-white/10' : 'bg-black/6',
      ].join(' ')}>
        <span className="text-base leading-none">💨</span>
        <div className="flex flex-col leading-tight">
          {weather.wsd !== null ? (
            <span className={`text-base font-bold tabular-nums ${dk || windLevel !== 'normal' ? 'text-white' : 'text-gray-900'}`}>
              {weather.wsd.toFixed(1)} m/s
            </span>
          ) : (
            <span className={dk ? 'text-white/40' : 'text-gray-400'}>— m/s</span>
          )}
          {windLevel !== 'normal' && (
            <span className="text-[10px] font-medium text-white/90">
              {windLevel === 'red' ? '⚠ 작업중단 기준!' : '⚠ 주의'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// MeetingMapViewer — 줌/팬 가능한 지적도 뷰어
// ────────────────────────────────────────────────────────
function MeetingMapViewer({
  meetingId, mapUrl, allTeamIds, hoveredTeamId,
}: {
  meetingId: string
  mapUrl: string
  allTeamIds: string[]
  hoveredTeamId?: string | null
}) {
  const theme = useTheme()
  const dk = theme === 'dark'

  const [markers,      setMarkers]      = useState<MapMarkerData[]>([])
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null)
  const [scale,        setScale]        = useState(1)
  const [offset,       setOffset]       = useState({ x: 0, y: 0 })
  const [isDragging,   setIsDragging]   = useState(false)
  const [naturalSize,  setNaturalSize]  = useState<{ w: number; h: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const lastPointer  = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    fetch(`/api/map-markers?meetingId=${meetingId}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setMarkers((data as MapMarkerData[]).filter(m => m.work_type === 'high_risk'))
        }
      })
      .catch(() => {})
  }, [meetingId])

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const natW = img.naturalWidth
    const natH = img.naturalHeight
    setNaturalSize({ w: natW, h: natH })
    if (!containerRef.current) return
    const { clientWidth: cW, clientHeight: cH } = containerRef.current
    setScale(Math.min(cW / natW, cH / natH))
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoom = useCallback((delta: number) => {
    setScale(s => Math.min(8, Math.max(0.1, s + delta)))
  }, [])

  const resetView = useCallback(() => {
    if (!naturalSize || !containerRef.current) return
    const { clientWidth: cW, clientHeight: cH } = containerRef.current
    setScale(Math.min(cW / naturalSize.w, cH / naturalSize.h))
    setOffset({ x: 0, y: 0 })
  }, [naturalSize])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    zoom(e.deltaY < 0 ? 0.08 : -0.08)
  }, [zoom])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    setIsDragging(true)
    lastPointer.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !lastPointer.current) return
    const dx = e.clientX - lastPointer.current.x
    const dy = e.clientY - lastPointer.current.y
    lastPointer.current = { x: e.clientX, y: e.clientY }
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }))
  }
  const handlePointerUp = () => { setIsDragging(false); lastPointer.current = null }

  const teamLegend = useMemo(() => {
    return allTeamIds
      .map((tid, idx) => {
        const tm = markers.filter(m => m.team_id === tid)
        if (tm.length === 0) return null
        return { id: tid, name: tm[0].teams?.name ?? tid, count: tm.length, color: TEAM_COLORS[idx % TEAM_COLORS.length] }
      })
      .filter(Boolean) as { id: string; name: string; count: number; color: string }[]
  }, [allTeamIds, markers])

  const teamColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    allTeamIds.forEach((tid, idx) => { m[tid] = TEAM_COLORS[idx % TEAM_COLORS.length] })
    return m
  }, [allTeamIds])

  const visibleMarkers = filterTeamId
    ? markers.filter(m => m.team_id === filterTeamId)
    : markers

  // 헤더/캔버스 테마
  const headerBg    = dk ? 'bg-neutral-800 border-neutral-700' : 'bg-red-50 border-red-200'
  const headerText  = dk ? 'text-red-300' : 'text-red-700'
  const canvasBg    = dk ? 'bg-neutral-900' : 'bg-slate-100'
  const zoomBtnCls  = dk
    ? 'bg-neutral-700/90 shadow-md text-neutral-200 hover:bg-neutral-600'
    : 'bg-white/95 shadow-md text-slate-700 hover:bg-white'
  const hintCls     = dk ? 'text-neutral-500 bg-neutral-800/80' : 'text-slate-400 bg-white/80'

  return (
    <div className={`flex flex-col h-full rounded-xl overflow-hidden border ${dk ? 'border-neutral-700' : 'border-red-200'}`}>
      {/* 헤더 */}
      <div className={`shrink-0 px-3 py-2 border-b flex items-center gap-2 flex-wrap ${headerBg}`}>
        <span className={`text-xs font-semibold ${headerText}`}>🗺️ 고위험작업 지적도</span>
        {teamLegend.length > 0 && (
          <div className="flex gap-1 ml-auto flex-wrap">
            <button
              onClick={() => setFilterTeamId(null)}
              className={[
                'text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors',
                filterTeamId === null
                  ? dk ? 'bg-white text-neutral-900' : 'bg-slate-800 text-white'
                  : dk ? 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400',
              ].join(' ')}
            >
              전체 ({markers.length})
            </button>
            {teamLegend.map(t => (
              <button
                key={t.id}
                onClick={() => setFilterTeamId(prev => prev === t.id ? null : t.id)}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors flex items-center gap-1"
                style={filterTeamId === t.id
                  ? { backgroundColor: t.color, color: 'white', border: `1px solid ${t.color}` }
                  : dk
                    ? { backgroundColor: '#404040', border: '1px solid #525252', color: '#d4d4d4' }
                    : { backgroundColor: 'white', border: '1px solid #e2e8f0', color: '#475569' }
                }
              >
                <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: t.color }} />
                {t.name} ({t.count})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 지도 캔버스 */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden ${canvasBg}`}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* 줌 컨트롤 */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
          {[
            { label: '+', action: () => zoom(0.2),  title: '확대' },
            { label: '⟲', action: resetView,        title: '화면 맞춤' },
            { label: '−', action: () => zoom(-0.2), title: '축소' },
          ].map(btn => (
            <button key={btn.label}
              onPointerDown={e => e.stopPropagation()}
              onClick={btn.action}
              title={btn.title}
              className={`w-8 h-8 rounded-lg font-bold text-lg flex items-center justify-center leading-none select-none transition-colors ${zoomBtnCls}`}
            >{btn.label}</button>
          ))}
        </div>

        {/* 배율 표시 */}
        <div className={`absolute bottom-2 right-3 z-20 text-[10px] px-1.5 py-0.5 rounded pointer-events-none ${hintCls}`}>
          {Math.round(scale * 100)}%
        </div>
        <div className={`absolute bottom-2 left-3 z-20 text-[10px] px-1.5 py-0.5 rounded pointer-events-none ${hintCls}`}>
          드래그: 이동 · 스크롤: 줌
        </div>

        {/* 이미지 + 마커 */}
        {naturalSize ? (
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            transformOrigin: 'center center',
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
          }}>
            <div className="relative" style={{ width: naturalSize.w, height: naturalSize.h }}>
              <img
                src={mapUrl} alt="지적도"
                style={{ width: naturalSize.w, height: naturalSize.h, display: 'block', pointerEvents: 'none' }}
                draggable={false}
              />
              {visibleMarkers.map(marker => {
                const color = marker.team_id ? (teamColorMap[marker.team_id] ?? '#6B7280') : '#6B7280'
                const isHighlighted = hoveredTeamId != null && marker.team_id === hoveredTeamId
                const isDimmed      = hoveredTeamId != null && marker.team_id !== hoveredTeamId
                return (
                  <div key={marker.id} className="absolute"
                    style={{
                      left: `${marker.x_pct}%`,
                      top: `${marker.y_pct}%`,
                      transform: `translate(-50%, -50%) scale(${isHighlighted ? 1.4 : 1})`,
                      transition: 'opacity 0.15s ease, transform 0.15s ease',
                      opacity: isDimmed ? 0.15 : 1,
                      zIndex: isHighlighted ? 30 : 10,
                    }}>
                    {/* 펄스 링 */}
                    {isHighlighted && (
                      <div className="absolute rounded-full animate-ping pointer-events-none"
                        style={{ inset: '-10px', background: 'rgba(250,204,21,0.5)' }} />
                    )}
                    <div className="flex flex-col items-center">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xl border-2 border-white"
                        style={{
                          background: color,
                          boxShadow: isHighlighted
                            ? `0 0 16px 4px rgba(250,204,21,0.6), 0 4px 12px rgba(0,0,0,0.3)`
                            : '0 4px 12px rgba(0,0,0,0.2)',
                        }}
                        title={`${marker.teams?.name ?? ''}${marker.label ? ' · ' + marker.label : ''}`}
                      >
                        {MARKER_ICONS[marker.marker_type] ?? '📍'}
                      </div>
                      {marker.label && (
                        <span className="text-[10px] font-semibold text-white px-1 py-0.5 rounded mt-0.5 max-w-[80px] truncate"
                          style={{ background: 'rgba(0,0,0,0.6)' }}>
                          {marker.label}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            <img src={mapUrl} alt="" onLoad={handleImgLoad}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
              draggable={false} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`w-6 h-6 border-2 rounded-full animate-spin ${dk ? 'border-neutral-600 border-t-neutral-300' : 'border-slate-200 border-t-slate-500'}`} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// HighRiskSlide
// ────────────────────────────────────────────────────────
function HighRiskSlide({ meetingId, mapUrl, workItems, allTeamIds }: {
  meetingId: string; mapUrl: string | null; workItems: WorkItem[]; allTeamIds: string[]
}) {
  const theme = useTheme()
  const dk = theme === 'dark'
  const highRisk = workItems.filter(w => w.work_type === 'high_risk')
  const [hoveredTeamId, setHoveredTeamId] = useState<string | null>(null)

  return (
    <div className="flex gap-4 items-start">
      {/* 지적도 — sticky로 고정, 카드 스크롤 시에도 계속 보임 */}
      {mapUrl ? (
        <div className="flex-1 min-w-0 sticky top-4" style={{ height: 'calc(100vh - 160px)' }}>
          <MeetingMapViewer
            meetingId={meetingId}
            mapUrl={mapUrl}
            allTeamIds={allTeamIds}
            hoveredTeamId={hoveredTeamId}
          />
        </div>
      ) : (
        <div className={`flex-1 sticky top-4 rounded-xl flex items-center justify-center border ${dk ? 'bg-neutral-800/50 border-white/10' : 'bg-gray-100 border-gray-200'}`}
          style={{ height: 'calc(100vh - 160px)' }}>
          <p className={dk ? 'text-white/30 text-sm' : 'text-gray-400 text-sm'}>지도 없음</p>
        </div>
      )}

      {/* 고위험작업 목록 */}
      <div className="w-[400px] shrink-0 space-y-2 pr-1">
        {highRisk.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className={`text-sm ${dk ? 'text-white/40' : 'text-gray-400'}`}>등록된 고위험작업이 없습니다.</p>
          </div>
        ) : (
          highRisk.map(item => {
            const isHovered = hoveredTeamId === item.team_id
            return (
              <div
                key={item.id}
                className={`rounded-xl p-3.5 border cursor-default transition-all duration-150 ${dk ? 'bg-red-950/50 border-red-800/30' : 'bg-red-50 border-red-200'}`}
                style={{
                  opacity: hoveredTeamId != null && !isHovered ? 0.4 : 1,
                  boxShadow: isHovered
                    ? dk ? '0 0 0 2px rgba(250,204,21,0.6), 0 4px 16px rgba(250,204,21,0.2)' : '0 0 0 2px #fbbf24, 0 4px 16px rgba(251,191,36,0.2)'
                    : undefined,
                }}
                onMouseEnter={() => setHoveredTeamId(item.team_id)}
                onMouseLeave={() => setHoveredTeamId(null)}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h4 className={`text-sm font-semibold leading-snug ${dk ? 'text-white' : 'text-gray-900'}`}>{item.work_name}</h4>
                  <div className={`flex gap-2 text-xs shrink-0 text-right ${dk ? 'text-white/40' : 'text-gray-400'}`}>
                    {item.location && <span>📍 {item.location}</span>}
                    {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                  </div>
                </div>
                <p className={`text-[11px] font-medium mb-1 ${dk ? 'text-red-300/70' : 'text-red-600'}`}>{item.teams?.name}</p>
                {item.description && <p className={`text-xs mb-1.5 ${dk ? 'text-white/50' : 'text-gray-500'}`}>{item.description}</p>}
                {item.risk_factors && (
                  <div className={`flex gap-1.5 rounded-lg px-2.5 py-1.5 mb-1 border ${dk ? 'bg-amber-950/50 border-amber-800/30' : 'bg-amber-50 border-amber-200'}`}>
                    <span className="text-amber-400 text-xs shrink-0">⚠</span>
                    <p className={`text-xs ${dk ? 'text-amber-200/80' : 'text-amber-800'}`}>{item.risk_factors}</p>
                  </div>
                )}
                {item.improvement_measures && (
                  <div className={`flex gap-1.5 rounded-lg px-2.5 py-1.5 border ${dk ? 'bg-emerald-950/50 border-emerald-800/30' : 'bg-emerald-50 border-emerald-200'}`}>
                    <span className="text-emerald-400 text-xs shrink-0">✅</span>
                    <p className={`text-xs ${dk ? 'text-emerald-200/80' : 'text-emerald-800'}`}>{item.improvement_measures}</p>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// WorkItemSlide
// ────────────────────────────────────────────────────────
function WorkItemSlide({ items }: { items: WorkItem[] }) {
  const theme = useTheme()
  const dk = theme === 'dark'

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className={`text-xl font-medium ${dk ? 'text-white/60' : 'text-gray-400'}`}>등록된 일반작업이 없습니다.</p>
      </div>
    )
  }

  const grouped: Record<string, WorkItem[]> = {}
  items.forEach(item => {
    const name = item.teams?.name ?? '미지정'
    if (!grouped[name]) grouped[name] = []
    grouped[name].push(item)
  })

  return (
    <div className="px-2 py-1 space-y-4">
      {Object.entries(grouped).map(([company, compItems]) => (
        <div key={company}>
          <div className={`flex items-center gap-2 mb-2 sticky top-0 backdrop-blur-sm py-1 px-2 rounded-md -mx-2 ${dk ? 'bg-neutral-900/80' : 'bg-gray-50/95'}`}>
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <h3 className={`text-sm font-semibold ${dk ? 'text-white/90' : 'text-gray-800'}`}>{company}</h3>
            <span className={`text-xs ml-auto ${dk ? 'text-white/40' : 'text-gray-400'}`}>{compItems.length}건</span>
          </div>
          <div className="space-y-2 pl-3">
            {compItems.map(item => (
              <div key={item.id} className={`rounded-xl p-4 border ${dk ? 'bg-blue-950/40 border-blue-800/30' : 'bg-blue-50 border-blue-200'}`}>
                <div className="flex items-start justify-between gap-4 mb-1.5">
                  <h4 className={`text-base font-semibold leading-snug ${dk ? 'text-white' : 'text-gray-900'}`}>{item.work_name}</h4>
                  <div className={`flex gap-3 text-sm shrink-0 ${dk ? 'text-white/50' : 'text-gray-400'}`}>
                    {item.location && <span>📍 {item.location}</span>}
                    {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                  </div>
                </div>
                {item.description && <p className={`text-sm mb-2 ${dk ? 'text-white/60' : 'text-gray-600'}`}>{item.description}</p>}
                {item.risk_factors && (
                  <div className={`flex gap-2 rounded-lg px-3 py-2 mb-1 border ${dk ? 'bg-amber-950/50 border-amber-800/30' : 'bg-amber-50 border-amber-200'}`}>
                    <span className="text-amber-400 text-sm shrink-0">⚠</span>
                    <p className={`text-sm ${dk ? 'text-amber-200/80' : 'text-amber-800'}`}>{item.risk_factors}</p>
                  </div>
                )}
                {item.improvement_measures && (
                  <div className={`flex gap-2 rounded-lg px-3 py-2 border ${dk ? 'bg-emerald-950/50 border-emerald-800/30' : 'bg-emerald-50 border-emerald-200'}`}>
                    <span className="text-emerald-400 text-sm shrink-0">✅</span>
                    <p className={`text-sm ${dk ? 'text-emerald-200/80' : 'text-emerald-800'}`}>{item.improvement_measures}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// MaterialSlide
// ────────────────────────────────────────────────────────
function MaterialSlide({ slots }: { slots: MaterialSlot[] }) {
  const theme = useTheme()
  const dk = theme === 'dark'

  const allReservations = slots.flatMap(slot =>
    (slot.material_reservations ?? []).map(r => ({ ...r, slot_time: slot.slot_time, gate: slot.gate }))
  )

  if (allReservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className={`text-xl font-medium ${dk ? 'text-white/60' : 'text-gray-400'}`}>등록된 자재 예약이 없습니다.</p>
      </div>
    )
  }

  const gates = [...new Set(allReservations.map(r => r.gate))].sort()

  return (
    <div>
      <div className="grid grid-cols-[80px_80px_1fr_1fr_120px] gap-0 mb-2 px-4">
        {['GATE', '시간대', '업체명', '자재 내용', '차량'].map(h => (
          <div key={h} className={`text-[10px] font-semibold uppercase tracking-widest py-2 ${dk ? 'text-white/30' : 'text-gray-400'}`}>{h}</div>
        ))}
      </div>
      <div className="space-y-4">
        {gates.map(gate => {
          const gateItems = allReservations.filter(r => r.gate === gate).sort((a, b) => a.slot_time.localeCompare(b.slot_time))
          return (
            <div key={gate}>
              <div className="flex items-center gap-2 px-4 py-1.5 mb-1">
                <span className="text-xs font-bold text-amber-500 tracking-widest">{gate}</span>
                <div className={`flex-1 h-px ${dk ? 'bg-amber-400/20' : 'bg-amber-200'}`} />
                <span className={`text-xs ${dk ? 'text-white/30' : 'text-gray-400'}`}>{gateItems.length}건</span>
              </div>
              {gateItems.map((r, idx) => (
                <div key={idx}
                  className={`grid grid-cols-[80px_80px_1fr_1fr_120px] gap-0 px-4 py-3 border-b transition-colors ${dk ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50'}`}>
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${dk ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>
                      {r.gate}
                    </span>
                  </div>
                  <div className={`text-sm font-semibold tabular-nums self-center ${dk ? 'text-white' : 'text-gray-800'}`}>
                    {r.slot_time?.slice(0, 5)}
                  </div>
                  <div className={`text-sm self-center ${dk ? 'text-white/70' : 'text-gray-600'}`}>{r.teams?.name ?? '미지정'}</div>
                  <div className={`text-sm self-center ${dk ? 'text-white/80' : 'text-gray-700'}`}>{r.material_description ?? '—'}</div>
                  <div className="self-center">
                    {r.vehicle_type && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${dk ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>
                        {r.vehicle_type}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// NotePanel
// ────────────────────────────────────────────────────────
function NotePanel({ meetingId, onClose }: {
  meetingId: string; onClose: () => void
}) {
  const theme = useTheme()
  const dk = theme === 'dark'
  const key = noteKey(meetingId)
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) ?? '' } catch { return '' } })
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    <div data-note-panel className={`absolute top-0 right-0 h-full w-72 flex flex-col z-30 shadow-2xl border-l ${dk ? 'bg-neutral-900/95 border-white/10' : 'bg-white/98 border-gray-200'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${dk ? 'border-white/10' : 'border-gray-200'}`}>
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-widest ${dk ? 'text-white/40' : 'text-gray-400'}`}>회의 메모</p>
          <p className={`text-xs mt-0.5 ${dk ? 'text-white/70' : 'text-gray-600'}`}>자동 저장</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[10px] text-emerald-500">저장됨 ✓</span>}
          <button onClick={onClose} className={`p-1 transition-colors ${dk ? 'text-white/40 hover:text-white/80' : 'text-gray-400 hover:text-gray-700'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="회의 관련 메모를 작성하세요.&#10;자동 저장됩니다."
        className={`flex-1 resize-none bg-transparent text-sm px-4 py-3 outline-none leading-relaxed ${dk ? 'text-white/80 placeholder-white/20' : 'text-gray-700 placeholder-gray-300'}`}
      />
      <div className={`px-4 py-2 border-t shrink-0 ${dk ? 'border-white/10' : 'border-gray-200'}`}>
        <p className={`text-[10px] ${dk ? 'text-white/25' : 'text-gray-300'}`}>입력 후 자동 저장 · 브라우저 로컬에 보관</p>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// ThemeToggle 버튼
// ────────────────────────────────────────────────────────
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dk = theme === 'dark'
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dk ? 'text-white/50 hover:text-white/80 hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
      title={dk ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      {dk ? (
        /* 태양 아이콘 */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        /* 달 아이콘 */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  )
}

// ────────────────────────────────────────────────────────
// MeetingModeView — 메인 컴포넌트
// ────────────────────────────────────────────────────────
export function MeetingModeView({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const [meeting,    setMeeting]    = useState<Meeting | null>(null)
  const [workItems,  setWorkItems]  = useState<WorkItem[]>([])
  const [slots,      setSlots]      = useState<MaterialSlot[]>([])
  const [allTeamIds, setAllTeamIds] = useState<string[]>([])
  const [loading,    setLoading]    = useState(true)
  const [activeSection, setActiveSection] = useState<SectionType>('high_risk')
  const [showNote,     setShowNote]     = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [theme,        setTheme]        = useState<Theme>('dark')
  const [pdfLoading,   setPdfLoading]   = useState(false)

  const containerRef  = useRef<HTMLDivElement>(null)
  const scrollBodyRef = useRef<HTMLDivElement>(null)
  const dk = theme === 'dark'

  useEffect(() => {
    Promise.all([
      fetch(`/api/meeting-info?meetingId=${meetingId}`).then(r => r.json()).catch(() => null),
      fetch(`/api/work-items?meetingId=${meetingId}`).then(r => r.json()).catch(() => []),
      fetch(`/api/material-slots?meetingId=${meetingId}`).then(r => r.json()).catch(() => []),
      fetch('/api/teams').then(r => r.json()).catch(() => []),
    ]).then(([mtgData, wiData, slotsData, teamsData]) => {
      if (mtgData?.meeting) setMeeting(mtgData.meeting)
      if (Array.isArray(wiData)) setWorkItems(wiData)
      if (Array.isArray(slotsData)) setSlots(slotsData)
      if (Array.isArray(teamsData)) setAllTeamIds(teamsData.map((t: { id: string }) => t.id))
      setLoading(false)
    })
  }, [meetingId])

  // 스크롤 위치에 따라 활성 섹션 추적
  useEffect(() => {
    const body = scrollBodyRef.current
    if (!body) return
    const handler = () => {
      for (const section of SECTIONS) {
        const el = document.getElementById(`section-${section.type}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= 120) setActiveSection(section.type)
      }
    }
    body.addEventListener('scroll', handler, { passive: true })
    return () => body.removeEventListener('scroll', handler)
  }, [loading])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showNote) setShowNote(false)
        else if (isFullscreen) document.exitFullscreen?.()
        else onClose()
      } else if (e.key === 'm' || e.key === 'M') setShowNote(s => !s)
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showNote, isFullscreen, onClose]) // eslint-disable-line

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.()
    else document.exitFullscreen?.()
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // 섹션으로 스크롤
  const scrollToSection = useCallback((type: SectionType) => {
    const el = document.getElementById(`section-${type}`)
    const body = scrollBodyRef.current
    if (!el || !body) return
    const offset = el.offsetTop - 16
    body.scrollTo({ top: offset, behavior: 'smooth' })
  }, [])

  // PDF 다운로드 (CDN html2canvas + jsPDF)
  const downloadPDF = useCallback(async () => {
    const body = scrollBodyRef.current
    if (!body || !meeting) return
    setPdfLoading(true)
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')

      // 스크롤 영역을 전체 높이로 임시 확장
      const origOverflow = body.style.overflow
      const origHeight   = body.style.height
      const origPosition = body.style.position
      body.style.overflow = 'visible'
      body.style.height   = body.scrollHeight + 'px'
      body.style.position = 'static'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const canvas = await (window as any).html2canvas(body, {
        useCORS: true, allowTaint: true, scale: 1.5,
        backgroundColor: dk ? '#0a0a0a' : '#f9fafb',
      })

      body.style.overflow = origOverflow
      body.style.height   = origHeight
      body.style.position = origPosition

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { jsPDF } = (window as any).jspdf
      const pdf    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW  = pdf.internal.pageSize.getWidth()
      const pageH  = pdf.internal.pageSize.getHeight()
      const ratio  = pageW / canvas.width
      const totalH = canvas.height * ratio
      let y = 0
      while (y < totalH) {
        if (y > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, -y, pageW, totalH)
        y += pageH
      }
      pdf.save(`DABs_회의자료_${meeting.date}.pdf`)
    } catch (err) {
      console.error('PDF 생성 오류:', err)
    } finally {
      setPdfLoading(false)
    }
  }, [dk, meeting])

  const generalItems  = useMemo(() => workItems.filter(w => w.work_type === 'general'), [workItems])
  const highRiskItems = useMemo(() => workItems.filter(w => w.work_type === 'high_risk'), [workItems])
  const mapUrl        = meeting?.map_file_url ?? null
  const materialCount = slots.reduce((acc, s) => acc + (s.material_reservations?.length ?? 0), 0)

  const sectionCount = (type: SectionType) => {
    if (type === 'high_risk')    return highRiskItems.length
    if (type === 'work_general') return generalItems.length
    return materialCount
  }

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

  const headerBorderStyle = { borderBottom: `1px solid ${dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }
  const footerBorderStyle = { borderTop:    `1px solid ${dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }
  const dividerStyle      = { borderColor:   dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }

  return (
    <ThemeCtx.Provider value={theme}>
      <div
        ref={containerRef}
        className={`fixed inset-0 flex flex-col z-50 select-none transition-colors duration-200 ${dk ? 'bg-neutral-950' : 'bg-gray-50'}`}
        style={{ fontFamily: 'var(--font-geist-sans, system-ui)' }}
      >
        {/* ── 헤더 ────────────────────────────────────── */}
        <header className="shrink-0 flex items-center justify-between px-5 py-3" style={headerBorderStyle}>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${dk ? 'text-white/50 hover:text-white/90' : 'text-gray-500 hover:text-gray-900'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              닫기
            </button>
            <div className={`w-px h-4 ${dk ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${dk ? 'text-white/30' : 'text-gray-400'}`}>DABs 회의 모드</p>
              <h1 className={`text-sm font-semibold leading-tight ${dk ? 'text-white/90' : 'text-gray-900'}`}>{meeting?.title ?? meetingId}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <WeatherWidget />
            <div className={`w-px h-5 ${dk ? 'bg-white/10' : 'bg-gray-200'}`} />
            <ThemeToggle theme={theme} onToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />
            <div className={`w-px h-5 ${dk ? 'bg-white/10' : 'bg-gray-200'}`} />
            {/* PDF 다운로드 */}
            <button
              onClick={downloadPDF}
              disabled={pdfLoading}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                pdfLoading
                  ? dk ? 'opacity-40 cursor-not-allowed text-white/40' : 'opacity-40 cursor-not-allowed text-gray-400'
                  : dk ? 'text-white/50 hover:text-white/80 hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100',
              ].join(' ')}
              title="PDF 다운로드">
              {pdfLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              )}
              {pdfLoading ? '생성 중…' : 'PDF'}
            </button>
            <div className={`w-px h-5 ${dk ? 'bg-white/10' : 'bg-gray-200'}`} />
            <button onClick={() => setShowNote(s => !s)}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                showNote
                  ? dk ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-800'
                  : dk ? 'text-white/50 hover:text-white/80 hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100',
              ].join(' ')}
              title="메모 (M)">
              📝 메모
            </button>
            <button onClick={toggleFullscreen}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dk ? 'text-white/50 hover:text-white/80 hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
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

        {/* ── 스크롤 본문 ──────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={scrollBodyRef}
            className={[
              'absolute inset-0 overflow-y-auto transition-[right] duration-300',
              showNote ? 'right-72' : 'right-0',
            ].join(' ')}
          >
            {/* ① 고위험 현황 */}
            <section id="section-high_risk" className="px-8 pt-6 pb-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">⚠️</span>
                <h2 className={`text-base font-bold ${dk ? 'text-white/90' : 'text-gray-900'}`}>고위험 현황</h2>
                {highRiskItems.length > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${dk ? 'bg-red-900/60 text-red-300' : 'bg-red-100 text-red-600'}`}>
                    {highRiskItems.length}건
                  </span>
                )}
              </div>
              <HighRiskSlide meetingId={meetingId} mapUrl={mapUrl} workItems={workItems} allTeamIds={allTeamIds} />
            </section>

            <div className="mx-8 border-t" style={dividerStyle} />

            {/* ② 일반작업 내용 */}
            <section id="section-work_general" className="px-8 pt-6 pb-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">📋</span>
                <h2 className={`text-base font-bold ${dk ? 'text-white/90' : 'text-gray-900'}`}>일반작업 내용</h2>
                {generalItems.length > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${dk ? 'bg-blue-900/60 text-blue-300' : 'bg-blue-100 text-blue-600'}`}>
                    {generalItems.length}건
                  </span>
                )}
              </div>
              <WorkItemSlide items={generalItems} />
            </section>

            <div className="mx-8 border-t" style={dividerStyle} />

            {/* ③ 자재 하역/운반 */}
            <section id="section-material" className="px-8 pt-6 pb-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🚛</span>
                <h2 className={`text-base font-bold ${dk ? 'text-white/90' : 'text-gray-900'}`}>자재 하역/운반</h2>
                {materialCount > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${dk ? 'bg-amber-900/60 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
                    {materialCount}건
                  </span>
                )}
              </div>
              <MaterialSlide slots={slots} />
            </section>
          </div>

          {/* 메모 패널 */}
          {showNote && (
            <NotePanel meetingId={meetingId} onClose={() => setShowNote(false)} />
          )}
        </div>

        {/* ── 하단 탭 바 (섹션 빠른 이동) ─────────────── */}
        <footer className="shrink-0 flex items-center gap-2 px-5 py-3" style={footerBorderStyle}>
          {SECTIONS.map(section => {
            const count    = sectionCount(section.type)
            const isActive = activeSection === section.type
            return (
              <button key={section.type}
                onClick={() => scrollToSection(section.type)}
                className={[
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150',
                  isActive
                    ? dk ? 'bg-white text-neutral-900' : 'bg-gray-900 text-white'
                    : dk ? 'text-white/50 hover:text-white/80 hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100',
                ].join(' ')}>
                <span>{section.icon}</span>
                <span>{section.label}</span>
                {count > 0 && (
                  <span className={[
                    'text-xs px-1.5 py-0.5 rounded-full font-semibold',
                    isActive
                      ? dk ? 'bg-neutral-900/20 text-neutral-700' : 'bg-white/20 text-white/90'
                      : dk ? 'bg-white/15 text-white/60'          : 'bg-gray-200 text-gray-500',
                  ].join(' ')}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          <div className={`ml-auto text-[11px] shrink-0 ${dk ? 'text-white/20' : 'text-gray-300'}`}>
            M 메모 · F 전체화면 · Esc 닫기
          </div>
        </footer>
      </div>
    </ThemeCtx.Provider>
  )
}
