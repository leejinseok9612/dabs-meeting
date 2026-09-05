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
  filterTeamIds, onFilterToggle, onFilterClear,
  workItems = [],
}: {
  meetingId: string
  mapUrl: string
  allTeamIds: string[]
  hoveredTeamId?: string | null
  filterTeamIds: Set<string>
  onFilterToggle: (id: string) => void
  onFilterClear: () => void
  workItems?: WorkItem[]
}) {
  const theme = useTheme()
  const dk = theme === 'dark'

  const [markers,       setMarkers]       = useState<MapMarkerData[]>([])
  const [clickedMarker, setClickedMarker] = useState<MapMarkerData | null>(null)
  const [scale,         setScale]         = useState(1)
  const [offset,        setOffset]        = useState({ x: 0, y: 0 })
  const [isDragging,    setIsDragging]    = useState(false)
  const [naturalSize,   setNaturalSize]   = useState<{ w: number; h: number } | null>(null)
  // ── 마커 편집 모드 ──────────────────────────────────────
  const [editMode,      setEditMode]      = useState(false)
  const [draggingMkId,  setDraggingMkId] = useState<string | null>(null)
  const draggingMkIdRef = useRef<string | null>(null)

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

  // 포인터 위치 → 이미지 내 x_pct / y_pct 변환
  const pctFromPointer = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current || !naturalSize) return null
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width  / 2 + offset.x
    const cy = rect.top  + rect.height / 2 + offset.y
    const imgL = cx - (naturalSize.w * scale) / 2
    const imgT = cy - (naturalSize.h * scale) / 2
    const relX = (clientX - imgL) / scale
    const relY = (clientY - imgT) / scale
    return {
      x: Math.max(0, Math.min(100, (relX / naturalSize.w) * 100)),
      y: Math.max(0, Math.min(100, (relY / naturalSize.h) * 100)),
    }
  }, [naturalSize, scale, offset])

  // 마커 삭제
  const deleteMarker = useCallback(async (id: string) => {
    setMarkers(prev => prev.filter(m => m.id !== id))
    await fetch(`/api/map-markers?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (draggingMkIdRef.current) return // 마커 드래그 중엔 지도 팬 안 함
    setIsDragging(true)
    lastPointer.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    // 마커 드래그 중
    if (draggingMkIdRef.current) {
      const pct = pctFromPointer(e.clientX, e.clientY)
      if (!pct) return
      setMarkers(prev => prev.map(m =>
        m.id === draggingMkIdRef.current ? { ...m, x_pct: pct.x, y_pct: pct.y } : m
      ))
      return
    }
    if (!isDragging || !lastPointer.current) return
    const dx = e.clientX - lastPointer.current.x
    const dy = e.clientY - lastPointer.current.y
    lastPointer.current = { x: e.clientX, y: e.clientY }
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }))
  }
  const handlePointerUp = async (e: React.PointerEvent) => {
    // 마커 드래그 종료 → API 저장
    if (draggingMkIdRef.current) {
      const id  = draggingMkIdRef.current
      const pct = pctFromPointer(e.clientX, e.clientY)
      if (pct) {
        await fetch('/api/map-markers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, x_pct: pct.x, y_pct: pct.y }),
        }).catch(() => {})
      }
      draggingMkIdRef.current = null
      setDraggingMkId(null)
      return
    }
    setIsDragging(false)
    lastPointer.current = null
  }

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

  const visibleMarkers = filterTeamIds.size > 0
    ? markers.filter(m => m.team_id && filterTeamIds.has(m.team_id))
    : markers

  // 클릭한 마커에 연결된 작업 항목 — 라벨 기반 매칭
  const clickedMarkerItems = useMemo(() => {
    if (!clickedMarker) return []
    const tid = clickedMarker.team_id ?? ''

    // 1순위: label === work_name 정확 매칭
    const exact = workItems.filter(w => w.team_id === tid && w.work_name === clickedMarker.label)
    if (exact.length) return exact

    // 2순위: 부분 문자열 매칭 (라벨이 있을 때만)
    if (clickedMarker.label) {
      const lbl = clickedMarker.label.toLowerCase()
      const fuzzy = workItems.filter(w =>
        w.team_id === tid && (
          w.work_name.toLowerCase().includes(lbl) ||
          lbl.includes(w.work_name.toLowerCase())
        )
      )
      if (fuzzy.length) return fuzzy
    }

    // 3순위: 같은 팀 + work_type 이 정확히 1건일 때만 (모호하지 않은 경우만 표시)
    if (clickedMarker.work_type) {
      const typeMatches = workItems.filter(w => w.team_id === tid && w.work_type === clickedMarker.work_type)
      if (typeMatches.length === 1) return typeMatches
    }

    // 매칭 실패 → 빈 배열 (팝업에서 "라벨과 일치하는 작업 없음" 메시지 표시)
    return []
  }, [clickedMarker, workItems])

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
        {/* 편집 모드 토글 */}
        <button
          onClick={() => { setEditMode(e => !e); setClickedMarker(null) }}
          className={[
            'text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors',
            editMode
              ? 'bg-orange-500 border-orange-400 text-white'
              : dk ? 'bg-neutral-700 border-neutral-600 text-neutral-300 hover:bg-neutral-600' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          {editMode ? '✏️ 편집 중' : '✏️ 편집'}
        </button>
        {editMode && (
          <span className={`text-[9px] ${dk ? 'text-orange-300/70' : 'text-orange-600/70'}`}>드래그: 이동 · ✕: 삭제</span>
        )}
        {teamLegend.length > 0 && (
          <div className="flex gap-1 ml-auto flex-wrap">
            <button
              onClick={onFilterClear}
              className={[
                'text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors',
                filterTeamIds.size === 0
                  ? dk ? 'bg-white text-neutral-900' : 'bg-slate-800 text-white'
                  : dk ? 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400',
              ].join(' ')}
            >
              전체 ({markers.length})
            </button>
            {teamLegend.map(t => {
              const active = filterTeamIds.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => onFilterToggle(t.id)}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors flex items-center gap-1"
                  style={active
                    ? { backgroundColor: t.color, color: 'white', border: `1px solid ${t.color}` }
                    : dk
                      ? { backgroundColor: '#404040', border: '1px solid #525252', color: '#d4d4d4' }
                      : { backgroundColor: 'white', border: '1px solid #e2e8f0', color: '#475569' }
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: t.color }} />
                  {t.name} ({t.count})
                  {active && <span className="ml-0.5 opacity-70">✓</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 마커 클릭 팝업 ─────────────────────────────────── */}
      {clickedMarker && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
          onClick={() => setClickedMarker(null)}
        >
          <div
            className={`rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden ${dk ? 'bg-neutral-900 border border-white/10' : 'bg-white'}`}
            onClick={e => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className={`px-6 pt-5 pb-4 border-b ${dk ? 'border-white/10' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-2xl border-2 border-white/30 shadow-lg"
                    style={{ background: teamColorMap[clickedMarker.team_id ?? ''] ?? '#6B7280' }}
                  >
                    {MARKER_ICONS[clickedMarker.marker_type] ?? '📍'}
                  </div>
                  <div>
                    <p className={`font-bold text-sm ${dk ? 'text-white' : 'text-gray-900'}`}>
                      {clickedMarker.teams?.name ?? '업체 미지정'}
                    </p>
                    {clickedMarker.label && (
                      <p className={`text-xs mt-0.5 ${dk ? 'text-white/50' : 'text-gray-500'}`}>{clickedMarker.label}</p>
                    )}
                    {clickedMarker.work_type && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-1 inline-block ${
                        clickedMarker.work_type === 'high_risk'
                          ? 'bg-red-100 text-red-600'
                          : 'bg-blue-100 text-blue-600'
                      }`}>
                        {clickedMarker.work_type === 'high_risk' ? '고위험 작업' : '일반 작업'}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setClickedMarker(null)}
                  className={`text-lg p-1 leading-none ${dk ? 'text-white/40 hover:text-white/80' : 'text-gray-400 hover:text-gray-700'}`}
                >✕</button>
              </div>
            </div>

            {/* 연결 작업 항목 */}
            {clickedMarkerItems.length > 0 ? (
              <div className="px-5 py-4 space-y-3 max-h-72 overflow-y-auto">
                {clickedMarkerItems.map(item => (
                  <div key={item.id} className="rounded-xl overflow-hidden"
                    style={{ border: item.work_type === 'high_risk' ? '1px solid rgba(252,165,165,0.5)' : '1px solid rgba(147,197,253,0.5)' }}>
                    <div className="px-3.5 py-2.5"
                      style={{ background: item.work_type === 'high_risk' ? 'rgba(254,242,242,0.85)' : 'rgba(239,246,255,0.85)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.work_type === 'high_risk' ? 'bg-red-400' : 'bg-blue-400'}`} />
                        <p className="text-xs font-semibold text-neutral-800 leading-snug">{item.work_name}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[10px] text-neutral-500 pl-3.5">
                        {item.location && <span>📍 {item.location}</span>}
                        {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                      </div>
                      {item.description && (
                        <p className="text-[10px] text-neutral-400 mt-1 pl-3.5 leading-relaxed">{item.description}</p>
                      )}
                    </div>
                    {item.risk_factors && (
                      <div className="px-3.5 py-2 border-t border-amber-100 bg-amber-50/70">
                        <p className="text-[10px] font-semibold text-amber-600 mb-0.5">⚠ 위험요인</p>
                        <p className="text-[11px] text-amber-800 leading-relaxed">{item.risk_factors}</p>
                      </div>
                    )}
                    {item.improvement_measures && (
                      <div className="px-3.5 py-2 border-t border-emerald-100 bg-emerald-50/70">
                        <p className="text-[10px] font-semibold text-emerald-600 mb-0.5">✅ 개선대책</p>
                        <p className="text-[11px] text-emerald-800 leading-relaxed">{item.improvement_measures}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className={`px-5 py-6 text-center ${dk ? 'text-white/35' : 'text-gray-400'}`}>
                <p className="text-2xl mb-2">🔍</p>
                <p className="text-xs">마커 라벨과 일치하는 작업 항목이 없습니다.</p>
                {clickedMarker.label && (
                  <p className={`text-[10px] mt-1 ${dk ? 'text-white/20' : 'text-gray-300'}`}>
                    라벨: &quot;{clickedMarker.label}&quot;
                  </p>
                )}
              </div>
            )}

            {/* 닫기 */}
            <div className="px-6 pb-5 pt-2">
              <button
                onClick={() => setClickedMarker(null)}
                className={`w-full py-2.5 rounded-xl text-sm border transition-colors ${dk ? 'border-white/10 text-white/60 hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 지도 캔버스 */}
      <div
        ref={containerRef}
        className={`map-canvas flex-1 relative overflow-hidden ${canvasBg}`}
        style={{ cursor: draggingMkId ? 'grabbing' : isDragging ? 'grabbing' : editMode ? 'default' : 'grab' }}
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
                const isHighlighted = !editMode && hoveredTeamId != null && marker.team_id === hoveredTeamId
                const isDimmed      = !editMode && hoveredTeamId != null && marker.team_id !== hoveredTeamId
                const isClicked     = clickedMarker?.id === marker.id
                const isBeingDragged = draggingMkId === marker.id
                return (
                  <div key={marker.id} className="absolute"
                    style={{
                      left: `${marker.x_pct}%`,
                      top: `${marker.y_pct}%`,
                      transform: `translate(-50%, -50%) scale(${isHighlighted || isClicked || isBeingDragged ? 1.4 : 1})`,
                      transition: isBeingDragged ? 'none' : 'opacity 0.15s ease, transform 0.15s ease',
                      opacity: isDimmed ? 0.15 : 1,
                      zIndex: isHighlighted || isClicked || isBeingDragged ? 30 : 10,
                      cursor: editMode ? 'grab' : 'pointer',
                    }}
                    onPointerDown={e => {
                      e.stopPropagation()
                      if (editMode) {
                        draggingMkIdRef.current = marker.id
                        setDraggingMkId(marker.id)
                        ;(e.currentTarget.closest('.map-canvas') as HTMLElement | null)
                          ?.setPointerCapture?.(e.pointerId)
                      }
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      if (!editMode && !isBeingDragged) setClickedMarker(prev => prev?.id === marker.id ? null : marker)
                    }}
                  >
                    {/* 편집 모드 삭제 버튼 */}
                    {editMode && (
                      <button
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 border border-white text-white flex items-center justify-center text-[9px] font-bold z-50 hover:bg-red-600"
                        style={{ lineHeight: 1 }}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); deleteMarker(marker.id) }}
                      >✕</button>
                    )}
                    {/* 펄스 링 */}
                    {!editMode && (isHighlighted || isClicked) && (
                      <div className="absolute rounded-full animate-ping pointer-events-none"
                        style={{ inset: '-10px', background: isClicked ? 'rgba(59,130,246,0.4)' : 'rgba(250,204,21,0.5)' }} />
                    )}
                    {editMode && isBeingDragged && (
                      <div className="absolute rounded-full pointer-events-none"
                        style={{ inset: '-8px', background: 'rgba(251,146,60,0.35)', borderRadius: '50%' }} />
                    )}
                    <div className="flex flex-col items-center">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xl border-2 border-white"
                        style={{
                          background: color,
                          boxShadow: editMode
                            ? `0 0 0 2px rgba(251,146,60,0.7), 0 4px 12px rgba(0,0,0,0.3)`
                            : isClicked
                              ? `0 0 16px 4px rgba(59,130,246,0.6), 0 4px 12px rgba(0,0,0,0.3)`
                              : isHighlighted
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
  // 다중 선택 팀 필터 (지도 헤더 ↔ 오른쪽 카드 목록 동기화)
  const [filterTeamIds, setFilterTeamIds] = useState<Set<string>>(new Set())

  const handleFilterToggle = useCallback((id: string) => {
    setFilterTeamIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const handleFilterClear = useCallback(() => setFilterTeamIds(new Set()), [])

  // 필터가 켜져 있으면 해당 업체 카드만 표시
  const visibleHighRisk = filterTeamIds.size > 0
    ? highRisk.filter(item => filterTeamIds.has(item.team_id))
    : highRisk

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
            filterTeamIds={filterTeamIds}
            onFilterToggle={handleFilterToggle}
            onFilterClear={handleFilterClear}
            workItems={workItems}
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
        {/* 필터 활성 시 안내 배지 */}
        {filterTeamIds.size > 0 && (
          <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${dk ? 'bg-neutral-800 text-white/60' : 'bg-slate-100 text-slate-500'}`}>
            <span>{filterTeamIds.size}개 업체 필터 중 · {visibleHighRisk.length}건 표시</span>
            <button onClick={handleFilterClear} className={`text-[10px] underline ${dk ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'}`}>전체 보기</button>
          </div>
        )}
        {visibleHighRisk.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className={`text-sm ${dk ? 'text-white/40' : 'text-gray-400'}`}>
              {filterTeamIds.size > 0 ? '선택한 업체의 고위험작업이 없습니다.' : '등록된 고위험작업이 없습니다.'}
            </p>
          </div>
        ) : (
          visibleHighRisk.map(item => {
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
                {/* ── 한 줄 헤더: 작업명 + 업체·위치·인원 ── */}
                <div className="flex items-baseline justify-between gap-2 mb-1 min-w-0">
                  <h4 className={`text-sm font-semibold leading-snug min-w-0 truncate ${dk ? 'text-white' : 'text-gray-900'}`}>{item.work_name}</h4>
                  <div className={`flex items-center gap-1 text-xs shrink-0 flex-wrap justify-end ml-1 ${dk ? 'text-white/40' : 'text-gray-400'}`}>
                    {item.teams?.name && <span className={`font-bold text-xs ${dk ? 'text-red-300/80' : 'text-red-600'}`}>{item.teams.name}</span>}
                    {item.location && <><span className={dk ? 'text-white/20' : 'text-gray-300'}>·</span><span>📍{item.location}</span></>}
                    {item.worker_count > 0 && <><span className={dk ? 'text-white/20' : 'text-gray-300'}>·</span><span>👷{item.worker_count}명</span></>}
                  </div>
                </div>
                {item.description && <p className={`text-xs mb-1 ${dk ? 'text-white/45' : 'text-gray-500'}`}>{item.description}</p>}
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
// WorkItemSlide — 업체별 아코디언
// ────────────────────────────────────────────────────────
function WorkItemSlide({ items }: { items: WorkItem[] }) {
  const theme = useTheme()
  const dk = theme === 'dark'

  // 업체별 그룹
  const grouped: Record<string, WorkItem[]> = {}
  items.forEach(item => {
    const name = item.teams?.name ?? '미지정'
    if (!grouped[name]) grouped[name] = []
    grouped[name].push(item)
  })
  const companies = Object.keys(grouped)

  // 아코디언 열림 상태 — 기본: 첫 번째 업체만 열림
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set(companies.slice(0, 1)))

  const toggleCompany = useCallback((name: string) => {
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const expandAll  = useCallback(() => setOpenSet(new Set(companies)), [companies.join(',')])  // eslint-disable-line
  const collapseAll = useCallback(() => setOpenSet(new Set()), [])

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className={`text-xl font-medium ${dk ? 'text-white/60' : 'text-gray-400'}`}>등록된 일반작업이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="px-2 py-1 space-y-2">
      {/* 전체 펼치기/접기 컨트롤 */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className={`text-xs ${dk ? 'text-white/30' : 'text-gray-400'}`}>
          {companies.length}개 업체 · {items.length}건
        </span>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${dk ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          >전체 펼치기</button>
          <button
            onClick={collapseAll}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${dk ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          >전체 접기</button>
        </div>
      </div>

      {companies.map(company => {
        const compItems = grouped[company]
        const isOpen = openSet.has(company)
        const hasRisk = compItems.some(i => i.risk_factors || i.improvement_measures)
        return (
          <div
            key={company}
            className={`rounded-xl overflow-hidden border transition-colors ${
              dk
                ? isOpen ? 'border-blue-800/40 bg-blue-950/20' : 'border-white/8 bg-white/3'
                : isOpen ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'
            }`}
          >
            {/* 업체 헤더 (클릭 시 토글) */}
            <button
              onClick={() => toggleCompany(company)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              {/* 아코디언 화살표 */}
              <svg
                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''} ${dk ? 'text-white/40' : 'text-gray-400'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>

              {/* 업체 이름 */}
              <span className={`text-sm font-semibold flex-1 text-left ${dk ? 'text-white/90' : 'text-gray-800'}`}>
                {company}
              </span>

              {/* 위험요인 배지 */}
              {hasRisk && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${dk ? 'bg-amber-900/60 text-amber-300' : 'bg-amber-100 text-amber-600'}`}>
                  ⚠ 위험요인
                </span>
              )}

              {/* 건수 배지 */}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                isOpen
                  ? dk ? 'bg-blue-700/60 text-blue-200' : 'bg-blue-600 text-white'
                  : dk ? 'bg-white/10 text-white/50' : 'bg-gray-100 text-gray-500'
              }`}>
                {compItems.length}건
              </span>
            </button>

            {/* 작업 항목 목록 (펼쳐진 경우) */}
            {isOpen && (
              <div className={`border-t px-4 pb-3 pt-2 space-y-2 ${dk ? 'border-white/8' : 'border-blue-100'}`}>
                {compItems.map(item => (
                  <div key={item.id} className={`rounded-lg overflow-hidden border ${dk ? 'border-blue-800/30' : 'border-blue-200'}`}>
                    <div className={`px-3.5 py-2.5 ${dk ? 'bg-blue-950/60' : 'bg-blue-50'}`}>
                      {/* ── 한 줄 헤더: 작업명 + 위치·인원 ── */}
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className={`text-sm font-semibold leading-snug ${dk ? 'text-white' : 'text-gray-900'}`}>{item.work_name}</h4>
                        <div className={`flex items-center gap-1 text-[11px] shrink-0 flex-wrap justify-end ${dk ? 'text-white/40' : 'text-gray-400'}`}>
                          {item.location && <span>📍{item.location}</span>}
                          {item.location && item.worker_count > 0 && <span className={dk ? 'text-white/20' : 'text-gray-300'}>·</span>}
                          {item.worker_count > 0 && <span>👷{item.worker_count}명</span>}
                        </div>
                      </div>
                      {item.description && <p className={`text-xs mt-0.5 ${dk ? 'text-white/50' : 'text-gray-500'}`}>{item.description}</p>}
                    </div>
                    {item.risk_factors && (
                      <div className={`flex gap-2 px-3.5 py-2 border-t ${dk ? 'bg-amber-950/50 border-amber-800/30' : 'bg-amber-50 border-amber-100'}`}>
                        <span className="text-amber-400 text-xs shrink-0 mt-0.5">⚠</span>
                        <p className={`text-xs ${dk ? 'text-amber-200/80' : 'text-amber-800'}`}>{item.risk_factors}</p>
                      </div>
                    )}
                    {item.improvement_measures && (
                      <div className={`flex gap-2 px-3.5 py-2 border-t ${dk ? 'bg-emerald-950/50 border-emerald-800/30' : 'bg-emerald-50 border-emerald-100'}`}>
                        <span className="text-emerald-400 text-xs shrink-0 mt-0.5">✅</span>
                        <p className={`text-xs ${dk ? 'text-emerald-200/80' : 'text-emerald-800'}`}>{item.improvement_measures}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// MaterialSlide
// ────────────────────────────────────────────────────────
function MaterialSlide({ slots }: { slots: MaterialSlot[] }) {
  const theme = useTheme()
  const dk = theme === 'dark'
  const [activeGate, setActiveGate] = useState<string>('all')

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
  const gateCount = (g: string) => g === 'all' ? allReservations.length : allReservations.filter(r => r.gate === g).length
  const visibleGates = activeGate === 'all' ? gates : [activeGate]
  const visibleItems = (gate: string) =>
    allReservations.filter(r => r.gate === gate).sort((a, b) => a.slot_time.localeCompare(b.slot_time))

  const tabCls = (active: boolean) => [
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
    active
      ? dk ? 'bg-white text-neutral-900' : 'bg-gray-900 text-white'
      : dk ? 'text-white/50 hover:bg-white/10 hover:text-white/80' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
  ].join(' ')

  const cntCls = (active: boolean) => [
    'text-xs px-1.5 py-0.5 rounded-full font-semibold',
    active
      ? dk ? 'bg-black/20 text-neutral-700' : 'bg-white/20 text-white/90'
      : dk ? 'bg-white/15 text-white/60' : 'bg-gray-200 text-gray-500',
  ].join(' ')

  return (
    <div>
      {/* ── GATE 탭 필터 ── */}
      <div className={`flex gap-1 mb-3 pb-3 border-b ${dk ? 'border-white/8' : 'border-gray-100'} flex-wrap`}>
        <button className={tabCls(activeGate === 'all')} onClick={() => setActiveGate('all')}>
          전체 <span className={cntCls(activeGate === 'all')}>{gateCount('all')}</span>
        </button>
        {gates.map(g => (
          <button key={g} className={tabCls(activeGate === g)} onClick={() => setActiveGate(g)}>
            {g} <span className={cntCls(activeGate === g)}>{gateCount(g)}</span>
          </button>
        ))}
      </div>

      {/* ── Sticky 테이블 헤더 ── */}
      <div className={`grid grid-cols-[80px_80px_1fr_1fr_120px] gap-0 px-4 sticky top-0 z-10 pt-1 pb-2 backdrop-blur-md ${dk ? 'bg-neutral-950/90' : 'bg-gray-50/95'}`}>
        {['GATE', '시간대', '업체명', '자재 내용', '차량'].map(h => (
          <div key={h} className={`text-[10px] font-semibold uppercase tracking-widest py-1.5 ${dk ? 'text-white/30' : 'text-gray-400'}`}>{h}</div>
        ))}
      </div>

      {/* ── 목록 ── */}
      <div className="space-y-4">
        {visibleGates.map(gate => {
          const items = visibleItems(gate)
          return (
            <div key={gate}>
              <div className="flex items-center gap-2 px-4 py-1.5 mb-1">
                <span className="text-xs font-bold text-amber-500 tracking-widest">{gate}</span>
                <div className={`flex-1 h-px ${dk ? 'bg-amber-400/20' : 'bg-amber-200'}`} />
                <span className={`text-xs ${dk ? 'text-white/30' : 'text-gray-400'}`}>{items.length}건</span>
              </div>
              {items.length === 0 ? (
                <div className={`flex items-center gap-2 px-4 py-6 ${dk ? 'text-white/30' : 'text-gray-400'}`}>
                  <span>📭</span>
                  <span className="text-sm">예정된 하역 일정이 없습니다.</span>
                </div>
              ) : items.map((r, idx) => (
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
// PdfFilterModal — PDF 출력 전 섹션/업체 필터
// ────────────────────────────────────────────────────────
interface PdfFilter {
  sections: { high_risk: boolean; general: boolean; material: boolean }
  companies: Set<string> // 빈 Set = 전체
}
function PdfFilterModal({ workItems, onConfirm, onCancel }: {
  workItems: WorkItem[]
  onConfirm: (f: PdfFilter) => void
  onCancel: () => void
}) {
  const theme = useTheme()
  const dk = theme === 'dark'

  const allCompanies = useMemo(() => {
    const s = new Set<string>()
    workItems.forEach(w => s.add(w.teams?.name ?? '미지정'))
    return [...s].sort()
  }, [workItems])

  const [sections, setSections] = useState({ high_risk: true, general: true, material: true })
  const [companies, setCompanies] = useState<Set<string>>(new Set()) // 빈 = 전체

  const toggleSection = (k: keyof typeof sections) =>
    setSections(p => ({ ...p, [k]: !p[k] }))

  const toggleCompany = (name: string) =>
    setCompanies(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })

  const isAllCo = companies.size === 0
  const toggleAllCo = () => setCompanies(isAllCo ? new Set(allCompanies) : new Set())

  const card = `rounded-xl border p-4 ${dk ? 'bg-neutral-800 border-white/10' : 'bg-white border-gray-200'}`
  const chk = (on: boolean) => `w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
    on ? 'bg-blue-500 border-blue-500' : dk ? 'border-white/30 bg-transparent' : 'border-gray-300 bg-white'
  }`

  const SECTION_LABELS = [
    { key: 'high_risk' as const,  icon: '⚠️', label: '고위험 현황' },
    { key: 'general'   as const,  icon: '📋', label: '일반작업 내용' },
    { key: 'material'  as const,  icon: '🚛', label: '자재 하역/운반' },
  ]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onClick={onCancel}>
      <div
        className={`w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden ${dk ? 'bg-neutral-900 border border-white/10' : 'bg-gray-50 border border-gray-200'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${dk ? 'border-white/10' : 'border-gray-200'}`}>
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-widest ${dk ? 'text-white/40' : 'text-gray-400'}`}>PDF 출력 설정</p>
            <p className={`text-sm font-bold mt-0.5 ${dk ? 'text-white' : 'text-gray-900'}`}>출력할 항목 선택</p>
          </div>
          <button onClick={onCancel} className={`p-1.5 rounded-lg ${dk ? 'text-white/40 hover:text-white/80 hover:bg-white/8' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}>✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 섹션 */}
          <div>
            <p className={`text-[11px] font-semibold mb-2 ${dk ? 'text-white/50' : 'text-gray-500'}`}>섹션 선택</p>
            <div className={card}>
              <div className="space-y-2.5">
                {SECTION_LABELS.map(({ key, icon, label }) => (
                  <button key={key} onClick={() => toggleSection(key)} className="flex items-center gap-3 w-full text-left">
                    <div className={chk(sections[key])}>
                      {sections[key] && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    <span className="text-sm">{icon}</span>
                    <span className={`text-sm ${dk ? 'text-white/80' : 'text-gray-700'}`}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 업체 필터 */}
          {allCompanies.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-[11px] font-semibold ${dk ? 'text-white/50' : 'text-gray-500'}`}>업체 필터</p>
                <button onClick={toggleAllCo} className={`text-[10px] px-2 py-0.5 rounded-full ${dk ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
                  {isAllCo ? '특정 업체만' : '전체 업체'}
                </button>
              </div>
              <div className={card}>
                <div className="space-y-2.5">
                  {allCompanies.map(co => {
                    const on = isAllCo || companies.has(co)
                    return (
                      <button key={co} onClick={() => { if (isAllCo) { setCompanies(new Set([co])) } else toggleCompany(co) }} className="flex items-center gap-3 w-full text-left">
                        <div className={chk(on)}>
                          {on && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                        </div>
                        <span className={`text-sm ${dk ? 'text-white/80' : 'text-gray-700'}`}>{co}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className={`px-5 pb-5 pt-2 flex gap-2 border-t ${dk ? 'border-white/10' : 'border-gray-200'}`}>
          <button onClick={onCancel} className={`flex-1 py-2.5 rounded-xl text-sm border transition-colors ${dk ? 'border-white/10 text-white/60 hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>취소</button>
          <button
            onClick={() => onConfirm({ sections, companies })}
            disabled={!sections.high_risk && !sections.general && !sections.material}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            📄 PDF 생성
          </button>
        </div>
      </div>
    </div>
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
  const [showNote,      setShowNote]      = useState(false)
  const [isFullscreen,  setIsFullscreen]  = useState(false)
  const [theme,         setTheme]         = useState<Theme>('dark')
  const [pdfLoading,    setPdfLoading]    = useState(false)
  const [pdfFilterOpen, setPdfFilterOpen] = useState(false)

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
        // ESC로 회의모드 자체를 닫지 않음 — 닫으려면 상단 닫기 버튼 사용
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

  // PDF 다운로드 — 새 창 HTML + 브라우저 인쇄
  // 구조: [지적도+마커] [고위험/업체별 3열] [일반작업/업체별 3열] [자재] [메모]
  const downloadPDF = useCallback(async (filter: PdfFilter) => {
    if (!meeting) return
    setPdfLoading(true)
    setPdfFilterOpen(false)

    // ── HTML 이스케이프 ─────────────────────────────────────
    const esc = (s: string) =>
      (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

    // ── 마커 데이터 fetch ────────────────────────────────────
    let pdfMarkers: MapMarkerData[] = []
    try {
      const res = await fetch(`/api/map-markers?meetingId=${meetingId}`)
      const data = await res.json()
      if (Array.isArray(data)) pdfMarkers = (data as MapMarkerData[]).filter(m => m.work_type === 'high_risk')
    } catch { /* 마커 없이 진행 */ }

    // ── 팀 컬러 맵 ──────────────────────────────────────────
    const pdfColorMap: Record<string, string> = {}
    allTeamIds.forEach((tid, idx) => { pdfColorMap[tid] = TEAM_COLORS[idx % TEAM_COLORS.length] })

    // ── 데이터 준비 (필터 적용) ─────────────────────────────
    const noteText = (() => { try { return localStorage.getItem(noteKey(meetingId)) ?? '' } catch { return '' } })()
    const coFilter = (w: WorkItem) =>
      filter.companies.size === 0 || filter.companies.has(w.teams?.name ?? '미지정')
    const highRisk = filter.sections.high_risk ? workItems.filter(w => w.work_type === 'high_risk' && coFilter(w)) : []
    const general  = filter.sections.general   ? workItems.filter(w => w.work_type === 'general'   && coFilter(w)) : []
    const allRes   = filter.sections.material
      ? slots.flatMap(s => (s.material_reservations ?? []).map(r => ({ ...r, slot_time: s.slot_time, gate: s.gate })))
      : []
    const pdfMapUrl = meeting.map_file_url ?? null

    // ── 지적도 위 마커 HTML ──────────────────────────────────
    const mapMarkersHtml = pdfMarkers.map(m => {
      const color = pdfColorMap[m.team_id ?? ''] ?? '#6B7280'
      const icon  = MARKER_ICONS[m.marker_type] ?? '📍'
      return `<div style="position:absolute;left:${m.x_pct}%;top:${m.y_pct}%;transform:translate(-50%,-100%);z-index:10;pointer-events:none;">
        <div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${icon}</div>
        ${m.label ? `<div style="font-size:8px;background:rgba(0,0,0,0.65);color:white;padding:1px 3px;border-radius:2px;margin-top:1px;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${esc(m.label)}</div>` : ''}
      </div>`
    }).join('')

    // ── 작업 카드 렌더 (3컬럼용 — 세로 레이아웃) ────────────
    const cardHtml = (item: WorkItem, color: 'red' | 'blue') => {
      const metaRow = [
        item.location    ? `📍${esc(item.location)}` : '',
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

    // ── 업체별 그룹핑 ────────────────────────────────────────
    const groupBy = (items: WorkItem[]) => {
      const g: Record<string, WorkItem[]> = {}
      items.forEach(item => {
        const n = item.teams?.name ?? '미지정'
        if (!g[n]) g[n] = []
        g[n].push(item)
      })
      return g
    }
    const renderGrouped = (grouped: Record<string, WorkItem[]>, color: 'red' | 'blue') =>
      Object.entries(grouped).map(([co, items]) =>
        `<div class="co-grp">
          <div class="co-title ${color}-co">${esc(co)} <span class="gcnt">${items.length}건</span></div>
          <div class="co-cards">${items.map(i => cardHtml(i, color)).join('')}</div>
        </div>`
      ).join('')

    const hrHtml = highRisk.length === 0
      ? '<p class="empty">등록된 고위험작업이 없습니다.</p>'
      : renderGrouped(groupBy(highRisk), 'red')

    const genHtml = general.length === 0
      ? '<p class="empty">등록된 일반작업이 없습니다.</p>'
      : renderGrouped(groupBy(general), 'blue')

    // ── 자재 테이블 ─────────────────────────────────────────
    const gates = [...new Set(allRes.map(r => r.gate))].sort()
    const matHtml = allRes.length === 0
      ? '<p class="empty">등록된 자재 예약이 없습니다.</p>'
      : `<table><thead><tr><th>GATE</th><th>시간</th><th>업체</th><th>자재 내용</th><th>차량</th></tr></thead><tbody>
         ${gates.flatMap(gate => {
           const rows = allRes.filter(r => r.gate === gate).sort((a,b) => a.slot_time.localeCompare(b.slot_time))
           return [
             `<tr><td colspan="5" class="gate-hd">${esc(gate)}</td></tr>`,
             ...rows.map(r => `<tr><td>${esc(r.gate)}</td><td class="mono">${(r.slot_time??'').slice(0,5)}</td>
               <td>${esc(r.teams?.name??'미지정')}</td><td>${esc(r.material_description??'—')}</td>
               <td>${esc(r.vehicle_type??'—')}</td></tr>`)
           ]
         }).join('')}
         </tbody></table>`

    // ── 페이지 섹션 배열 구성 (조건에 따라 섹션 추가) ────────
    const pageSections: string[] = []

    // 지적도
    if (pdfMapUrl) {
      pageSections.push(
        `<div class="sec-title">🗺️ 고위험작업 지적도 <span class="badge br">${pdfMarkers.length}개소</span></div>` +
        `<div class="map-wrap"><img src="${pdfMapUrl}" alt="지적도">${mapMarkersHtml}</div>`
      )
    }
    // 고위험 현황
    if (filter.sections.high_risk) {
      pageSections.push(
        `<div class="sec-title">⚠️ 고위험 현황 <span class="badge br">${highRisk.length}건</span></div>${hrHtml}`
      )
    }
    // 일반작업
    if (filter.sections.general) {
      pageSections.push(
        `<div class="sec-title">📋 일반작업 내용 <span class="badge bb">${general.length}건</span></div>${genHtml}`
      )
    }
    // 자재 하역/운반
    if (filter.sections.material) {
      pageSections.push(
        `<div class="sec-title">🚛 자재 하역/운반 <span class="badge ba">${allRes.length}건</span></div>${matHtml}`
      )
    }
    // 메모
    if (noteText.trim()) {
      pageSections.push(
        `<div class="sec-title">📝 회의 메모</div><pre class="note-pre">${esc(noteText)}</pre>`
      )
    }

    // 섹션을 page-break 구분자로 연결
    const bodyHtml = pageSections
      .map((sec, i) => i === 0 ? sec : `<div class="page-break">${sec}</div>`)
      .join('\n')

    // ── 전체 HTML ────────────────────────────────────────────
    const html = `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<title>DABs 회의자료_${esc(meeting.date)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 portrait;margin:14mm 16mm}
body{font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',system-ui,sans-serif;font-size:11px;color:#111;background:#fff}
/* ── 공통 ── */
.page-break{page-break-before:always;break-before:page;padding-top:0}
.pg-hd{padding:0 0 10px;border-bottom:3px solid #111;margin-bottom:14px}
.pg-title{font-size:18px;font-weight:800;letter-spacing:-.5px}
.pg-meta{font-size:9px;color:#6b7280;margin-top:4px}
.sec-title{font-size:13px;font-weight:700;margin-bottom:11px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;display:flex;align-items:center;gap:7px}
.badge{display:inline-block;padding:2px 7px;border-radius:9px;font-size:9px;font-weight:700}
.br{background:#fef2f2;color:#dc2626}.bb{background:#eff6ff;color:#2563eb}.ba{background:#fffbeb;color:#b45309}
.empty{color:#9ca3af;padding:10px 0;font-size:11px}
/* ── 지적도 ── */
.map-wrap{position:relative;display:block;width:100%;line-height:0}
.map-wrap img{width:100%;height:auto;display:block;max-height:215mm;object-fit:contain}
/* ── 작업 카드 (3컬럼 그리드) ── */
.co-grp{margin-bottom:18px}
.co-title{font-size:12px;font-weight:800;color:#111;background:#f3f4f6;border-radius:5px;padding:5px 10px;margin-bottom:6px;display:flex;align-items:center;gap:6px;letter-spacing:-.3px;border-left:3px solid #9ca3af}
.co-title.red-co{border-left-color:#ef4444;color:#991b1b}
.co-title.blue-co{border-left-color:#3b82f6;color:#1e40af}
.gcnt{font-size:10px;color:#9ca3af;font-weight:400;margin-left:4px}
/* 3컬럼 그리드 */
.co-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.card{border-radius:5px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;border:1px solid #e5e7eb;display:flex;flex-direction:column}
.card-top{padding:6px 9px;flex:1}
.card.red .card-top{background:#fef2f2;border-bottom:1px solid #fecaca}
.card.blue .card-top{background:#eff6ff;border-bottom:1px solid #bfdbfe}
.ctitle{font-size:10px;font-weight:700;line-height:1.35;margin-bottom:2px}
.cmeta{font-size:8px;color:#6b7280;line-height:1.3}
.cdesc{font-size:8px;color:#6b7280;margin-top:2px;line-height:1.3}
/* 위험요인·개선대책: 레이블+내용 한 줄 */
.risk{padding:3px 9px;background:#fffbeb;border-top:1px solid #fde68a;font-size:9px;color:#78350f;line-height:1.4}
.impr{padding:3px 9px;background:#f0fdf4;border-top:1px solid #bbf7d0;font-size:9px;color:#14532d;line-height:1.4}
.lbl{display:inline;font-size:8px;font-weight:700;margin-right:4px}
.risk .lbl{color:#b45309}.impr .lbl{color:#16a34a}
/* ── 자재 ── */
table{width:100%;border-collapse:collapse}
th{font-size:9px;font-weight:700;color:#6b7280;text-align:left;padding:5px 8px;border-bottom:2px solid #e5e7eb;background:#f9fafb}
td{font-size:10px;padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}
.gate-hd{font-weight:700;color:#b45309;background:#fffbeb;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a;font-size:9px;letter-spacing:.5px}
.mono{font-variant-numeric:tabular-nums;font-weight:600}
/* ── 메모 ── */
.note-pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:11px;line-height:1.8;color:#374151;padding:14px;background:#f9fafb;border-radius:7px;border:1px solid #e5e7eb;max-height:220mm;overflow:hidden}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<!-- ▌공통 헤더 -->
<div class="pg-hd">
  <div class="pg-title">📋 ${esc(meeting.title || 'DABs 회의 자료')}</div>
  <div class="pg-meta">회의 일자: ${esc(meeting.date)} &nbsp;·&nbsp; 출력: ${new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}</div>
</div>

${bodyHtml}

<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},500)})</script>
</body></html>`

    // ── 새 창에 출력 ─────────────────────────────────────────
    const pw = window.open('', '_blank', 'width=1100,height=850')
    if (!pw) {
      alert('팝업이 차단되어 있습니다.\n브라우저 주소창에서 팝업을 허용한 후 다시 시도해주세요.')
      setPdfLoading(false)
      return
    }
    pw.document.open()
    pw.document.write(html)
    pw.document.close()
    setPdfLoading(false)
  }, [meeting, meetingId, workItems, slots, allTeamIds])

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
              onClick={() => setPdfFilterOpen(true)}
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

          {/* 전체화면 시 플로팅 종료 버튼 */}
          {isFullscreen && (
            <button
              onClick={() => document.exitFullscreen?.()}
              className="fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md bg-black/40 text-white/80 hover:bg-black/60 hover:text-white border border-white/10 transition-all shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
              전체화면 종료
            </button>
          )}
        </div>

        {/* PDF 필터 모달 */}
        {pdfFilterOpen && (
          <PdfFilterModal
            workItems={workItems}
            onConfirm={filter => downloadPDF(filter)}
            onCancel={() => setPdfFilterOpen(false)}
          />
        )}

        {/* ── 하단 탭 바 (섹션 빠른 이동) ─────────────── */}
        <footer className="shrink-0 flex items-center gap-2 px-5 py-3" style={footerBorderStyle}>
          {SECTIONS.map(section => {
            const count    = sectionCount(section.type)
            const isActive = activeSection === section.type
            return (
              <button key={section.type}
                onClick={() => { setActiveSection(section.type); scrollToSection(section.type) }}
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
          <button
            onClick={onClose}
            className={`ml-2 text-[11px] px-2.5 py-1 rounded-lg border transition-colors shrink-0 ${dk ? 'border-white/10 text-white/30 hover:text-white/70 hover:border-white/20' : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'}`}
          >
            닫기
          </button>
        </footer>
      </div>
    </ThemeCtx.Provider>
  )
}
