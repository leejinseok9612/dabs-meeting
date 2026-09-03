// ============================================================
// app/components/views/MeetingModeView.tsx
// DABs 회의 모드 — 전체화면 슬라이드쇼 + 기상청 날씨 + 메모 패널
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ── 팀 색상 (MapAnnotator 와 동일) ────────────────────────
const TEAM_COLORS = ['#3B82F6','#F97316','#22C55E','#8B5CF6','#EF4444','#EC4899']

// ── 마커 아이콘 매핑 ─────────────────────────────────────
const MARKER_ICONS: Record<string, string> = {
  excavator: '🚜', small_exc: '🔧', crane: '🏗️', dump_truck: '🚛',
  pump_car: '🚰', roller: '🛞', pile_driver: '⚙️', loader: '🔄',
  forklift: '🏋️', work_zone: '⚠️', personnel: '👷', material: '📦',
}

// ── 타입 ─────────────────────────────────────────────────
interface MapMarkerData {
  id: string
  team_id: string | null
  marker_type: string
  x_pct: number
  y_pct: number
  label?: string
  work_type?: string | null
  teams?: { id: string; name: string }
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

// ── 슬라이드 정의 ─────────────────────────────────────────
type SlideType = 'high_risk' | 'work_general' | 'material'
const SLIDES: { type: SlideType; label: string; icon: string }[] = [
  { type: 'high_risk',    label: '고위험 현황',     icon: '⚠️' },
  { type: 'work_general', label: '일반작업 내용',   icon: '📋' },
  { type: 'material',     label: '자재 하역/운반',  icon: '🚛' },
]

// ── 메모 로컬스토리지 키 ─────────────────────────────────
const noteKey = (meetingId: string, slideIdx: number) =>
  `dabs_note_${meetingId}_${slideIdx}`

// ── 날씨 아이콘 (PTY 기반 — 초단기실황엔 SKY 없음) ──────
function weatherIcon(pty: number | null): string {
  if (!pty || pty === 0) return '🌤'
  if (pty === 3) return '❄️'
  return '🌧'
}

// ────────────────────────────────────────────────────────
// WeatherWidget
// ────────────────────────────────────────────────────────
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
        <div className="w-20 h-4 rounded animate-pulse bg-white/20" />
      </div>
    )
  }

  const windLevel = weather.windWarning ? 'red' : weather.windCaution ? 'amber' : 'normal'

  return (
    <div className="flex items-center gap-2">
      {/* 기온 */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm">
        <span className="text-lg leading-none">{weatherIcon(weather.pty)}</span>
        {weather.tmp !== null ? (
          <span className="text-base font-bold text-white tabular-nums">{weather.tmp.toFixed(1)}°C</span>
        ) : (
          <span className="text-sm text-white/40">—°C</span>
        )}
        {weather.isMock && <span className="text-[9px] text-white/30 ml-1">mock</span>}
      </div>

      {/* 풍속 */}
      <div className={[
        'flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm',
        windLevel === 'red'   ? 'bg-red-500/80 animate-pulse' :
        windLevel === 'amber' ? 'bg-amber-500/80'             :
        'bg-white/10',
      ].join(' ')}>
        <span className="text-base leading-none">💨</span>
        <div className="flex flex-col leading-tight">
          {weather.wsd !== null ? (
            <span className="text-base font-bold text-white tabular-nums">{weather.wsd.toFixed(1)} m/s</span>
          ) : (
            <span className="text-sm text-white/40">— m/s</span>
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
  meetingId, mapUrl, allTeamIds,
}: {
  meetingId: string
  mapUrl: string
  allTeamIds: string[]
}) {
  const [markers,      setMarkers]      = useState<MapMarkerData[]>([])
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null)
  const [scale,        setScale]        = useState(1)
  const [offset,       setOffset]       = useState({ x: 0, y: 0 })
  const [isDragging,   setIsDragging]   = useState(false)
  const [naturalSize,  setNaturalSize]  = useState<{ w: number; h: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const lastPointer  = useRef<{ x: number; y: number } | null>(null)

  // ── 마커 로드 ─────────────────────────────────────────
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

  // ── 이미지 로드 → 화면 맞춤 scale 계산 ──────────────
  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const natW = img.naturalWidth
    const natH = img.naturalHeight
    setNaturalSize({ w: natW, h: natH })

    if (!containerRef.current) return
    const { clientWidth: cW, clientHeight: cH } = containerRef.current
    // 가용 영역에 꽉 차되 잘리지 않는 최대 배율 (업스케일 허용: 화면이 이미지보다 클 때)
    const fitScale = Math.min(cW / natW, cH / natH)
    setScale(fitScale)
    setOffset({ x: 0, y: 0 })
  }, [])

  // ── 줌 ────────────────────────────────────────────────
  const zoom = useCallback((delta: number) => {
    setScale(s => Math.min(8, Math.max(0.1, s + delta)))
  }, [])

  const resetView = useCallback(() => {
    if (!naturalSize || !containerRef.current) return
    const { clientWidth: cW, clientHeight: cH } = containerRef.current
    setScale(Math.min(cW / naturalSize.w, cH / naturalSize.h))
    setOffset({ x: 0, y: 0 })
  }, [naturalSize])

  // ── 마우스 휠 줌 ──────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    zoom(e.deltaY < 0 ? 0.08 : -0.08)
  }, [zoom])

  // ── 팬 (드래그) ───────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 버튼 영역 클릭 무시
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
  const handlePointerUp = () => {
    setIsDragging(false)
    lastPointer.current = null
  }

  // ── 팀 범례 ─────────────────────────────────────────
  const teamLegend = useMemo(() => {
    return allTeamIds
      .map((tid, idx) => {
        const teamMarkers = markers.filter(m => m.team_id === tid)
        if (teamMarkers.length === 0) return null
        const name = teamMarkers[0].teams?.name ?? tid
        return { id: tid, name, count: teamMarkers.length, color: TEAM_COLORS[idx % TEAM_COLORS.length] }
      })
      .filter(Boolean) as { id: string; name: string; count: number; color: string }[]
  }, [allTeamIds, markers])

  // 팀 컬러 룩업
  const teamColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    allTeamIds.forEach((tid, idx) => { m[tid] = TEAM_COLORS[idx % TEAM_COLORS.length] })
    return m
  }, [allTeamIds])

  const visibleMarkers = filterTeamId
    ? markers.filter(m => m.team_id === filterTeamId)
    : markers

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden border border-red-200 bg-white">

      {/* 헤더: 타이틀 + 팀 필터 */}
      <div className="shrink-0 px-3 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-red-700">🗺️ 고위험작업 지적도</span>

        {teamLegend.length > 0 && (
          <div className="flex gap-1 ml-auto flex-wrap">
            <button
              onClick={() => setFilterTeamId(null)}
              className={[
                'text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors',
                filterTeamId === null
                  ? 'bg-slate-800 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400',
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
        className="flex-1 relative overflow-hidden bg-slate-100"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >

        {/* 줌 컨트롤 버튼 */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={() => zoom(0.2)}
            className="w-8 h-8 rounded-lg bg-white/95 shadow-md text-slate-700 font-bold text-xl hover:bg-white flex items-center justify-center leading-none select-none"
            title="확대"
          >+</button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={resetView}
            className="w-8 h-8 rounded-lg bg-white/95 shadow-md text-slate-600 text-sm hover:bg-white flex items-center justify-center select-none"
            title="화면 맞춤"
          >⟲</button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={() => zoom(-0.2)}
            className="w-8 h-8 rounded-lg bg-white/95 shadow-md text-slate-700 font-bold text-xl hover:bg-white flex items-center justify-center leading-none select-none"
            title="축소"
          >−</button>
        </div>

        {/* 배율 표시 */}
        <div className="absolute bottom-2 right-3 z-20 text-[10px] text-slate-400 bg-white/80 px-1.5 py-0.5 rounded pointer-events-none">
          {Math.round(scale * 100)}%
        </div>

        {/* 조작 힌트 */}
        <div className="absolute bottom-2 left-3 z-20 text-[10px] text-slate-400 bg-white/80 px-1.5 py-0.5 rounded pointer-events-none">
          드래그: 이동 · 스크롤: 줌
        </div>

        {/* 이미지 + 마커 (변환 레이어) */}
        {naturalSize ? (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transformOrigin: 'center center',
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
            }}
          >
            <div
              className="relative"
              style={{ width: naturalSize.w, height: naturalSize.h }}
            >
              <img
                src={mapUrl}
                alt="지적도"
                style={{ width: naturalSize.w, height: naturalSize.h, display: 'block', pointerEvents: 'none' }}
                draggable={false}
              />
              {/* 마커 오버레이 */}
              {visibleMarkers.map(marker => {
                const color = marker.team_id ? (teamColorMap[marker.team_id] ?? '#6B7280') : '#6B7280'
                return (
                  <div
                    key={marker.id}
                    className="absolute z-10"
                    style={{
                      left: `${marker.x_pct}%`,
                      top: `${marker.y_pct}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="flex flex-col items-center">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xl shadow-lg border-2 border-white"
                        style={{ background: color }}
                        title={`${marker.teams?.name ?? ''}${marker.label ? ' · ' + marker.label : ''}`}
                      >
                        {MARKER_ICONS[marker.marker_type] ?? '📍'}
                      </div>
                      {marker.label && (
                        <span
                          className="text-[10px] font-semibold text-white px-1 py-0.5 rounded mt-0.5 max-w-[80px] truncate"
                          style={{ background: 'rgba(0,0,0,0.6)' }}
                        >
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
          /* 이미지 크기 측정용 (숨김) */
          <img
            src={mapUrl}
            alt=""
            onLoad={handleImgLoad}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
            draggable={false}
          />
        )}

        {/* 로딩 중 스피너 */}
        {!naturalSize && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// HighRiskSlide — 지적도(좌) + 고위험작업 목록(우) 분할 뷰
// ────────────────────────────────────────────────────────
function HighRiskSlide({
  meetingId, mapUrl, workItems, allTeamIds,
}: {
  meetingId: string
  mapUrl: string | null
  workItems: WorkItem[]
  allTeamIds: string[]
}) {
  const highRisk = workItems.filter(w => w.work_type === 'high_risk')

  return (
    <div className="h-full flex gap-4">
      {/* 왼쪽: 줌/팬 지적도 */}
      {mapUrl ? (
        <div className="flex-1 min-w-0">
          <MeetingMapViewer
            meetingId={meetingId}
            mapUrl={mapUrl}
            allTeamIds={allTeamIds}
          />
        </div>
      ) : (
        <div className="flex-1 rounded-xl bg-neutral-800/50 border border-white/10 flex items-center justify-center">
          <p className="text-white/30 text-sm">지도 없음</p>
        </div>
      )}

      {/* 오른쪽: 고위험작업 목록 */}
      <div className="w-[400px] shrink-0 overflow-y-auto space-y-2 pr-1 scrollbar-hide">
        {highRisk.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-white/40 text-sm">등록된 고위험작업이 없습니다.</p>
          </div>
        ) : (
          highRisk.map(item => (
            <div key={item.id}
              className="rounded-xl p-3.5 bg-red-950/50 border border-red-800/30">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h4 className="text-sm font-semibold text-white leading-snug">{item.work_name}</h4>
                <div className="flex gap-2 text-xs text-white/40 shrink-0 text-right">
                  {item.location && <span>📍 {item.location}</span>}
                  {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                </div>
              </div>
              <p className="text-[11px] text-red-300/70 font-medium mb-1">{item.teams?.name}</p>
              {item.description && (
                <p className="text-xs text-white/50 mb-1.5">{item.description}</p>
              )}
              {item.risk_factors && (
                <div className="flex gap-1.5 bg-amber-950/50 border border-amber-800/30 rounded-lg px-2.5 py-1.5 mb-1">
                  <span className="text-amber-400 text-xs shrink-0">⚠</span>
                  <p className="text-xs text-amber-200/80">{item.risk_factors}</p>
                </div>
              )}
              {item.improvement_measures && (
                <div className="flex gap-1.5 bg-emerald-950/50 border border-emerald-800/30 rounded-lg px-2.5 py-1.5">
                  <span className="text-emerald-400 text-xs shrink-0">✅</span>
                  <p className="text-xs text-emerald-200/80">{item.improvement_measures}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// WorkItemSlide — 일반작업 목록
// ────────────────────────────────────────────────────────
function WorkItemSlide({ items }: { items: WorkItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className="text-xl font-medium text-white/60">등록된 일반작업이 없습니다.</p>
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
    <div className="h-full overflow-y-auto px-2 py-1 space-y-4 scrollbar-hide">
      {Object.entries(grouped).map(([company, compItems]) => (
        <div key={company}>
          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-neutral-900/80 backdrop-blur-sm py-1 px-2 rounded-md -mx-2">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <h3 className="text-sm font-semibold text-white/90">{company}</h3>
            <span className="text-xs text-white/40 ml-auto">{compItems.length}건</span>
          </div>
          <div className="space-y-2 pl-3">
            {compItems.map(item => (
              <div key={item.id}
                className="rounded-xl p-4 bg-blue-950/40 border border-blue-800/30">
                <div className="flex items-start justify-between gap-4 mb-1.5">
                  <h4 className="text-base font-semibold text-white leading-snug">{item.work_name}</h4>
                  <div className="flex gap-3 text-sm text-white/50 shrink-0">
                    {item.location && <span>📍 {item.location}</span>}
                    {item.worker_count > 0 && <span>👷 {item.worker_count}명</span>}
                  </div>
                </div>
                {item.description && <p className="text-sm text-white/60 mb-2">{item.description}</p>}
                {item.risk_factors && (
                  <div className="flex gap-2 bg-amber-950/50 border border-amber-800/30 rounded-lg px-3 py-2 mb-1">
                    <span className="text-amber-400 text-sm shrink-0">⚠</span>
                    <p className="text-sm text-amber-200/80">{item.risk_factors}</p>
                  </div>
                )}
                {item.improvement_measures && (
                  <div className="flex gap-2 bg-emerald-950/50 border border-emerald-800/30 rounded-lg px-3 py-2">
                    <span className="text-emerald-400 text-sm shrink-0">✅</span>
                    <p className="text-sm text-emerald-200/80">{item.improvement_measures}</p>
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
// MaterialSlide — 자재 하역/운반 목록
// ────────────────────────────────────────────────────────
function MaterialSlide({ slots }: { slots: MaterialSlot[] }) {
  const allReservations = slots.flatMap(slot =>
    (slot.material_reservations ?? []).map(r => ({ ...r, slot_time: slot.slot_time, gate: slot.gate }))
  )

  if (allReservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className="text-xl font-medium text-white/60">등록된 자재 예약이 없습니다.</p>
      </div>
    )
  }

  const gates = [...new Set(allReservations.map(r => r.gate))].sort()

  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      <div className="grid grid-cols-[80px_80px_1fr_1fr_120px] gap-0 mb-2 px-4">
        {['GATE', '시간대', '업체명', '자재 내용', '차량'].map(h => (
          <div key={h} className="text-[10px] font-semibold text-white/30 uppercase tracking-widest py-2">{h}</div>
        ))}
      </div>

      <div className="space-y-4">
        {gates.map(gate => {
          const gateItems = allReservations
            .filter(r => r.gate === gate)
            .sort((a, b) => a.slot_time.localeCompare(b.slot_time))

          return (
            <div key={gate}>
              <div className="flex items-center gap-2 px-4 py-1.5 mb-1">
                <span className="text-xs font-bold text-amber-400 tracking-widest">{gate}</span>
                <div className="flex-1 h-px bg-amber-400/20" />
                <span className="text-xs text-white/30">{gateItems.length}건</span>
              </div>
              {gateItems.map((r, idx) => (
                <div key={idx}
                  className="grid grid-cols-[80px_80px_1fr_1fr_120px] gap-0 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors">
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white/60">
                      {r.gate}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-white tabular-nums self-center">
                    {r.slot_time?.slice(0, 5)}
                  </div>
                  <div className="text-sm text-white/70 self-center">{r.teams?.name ?? '미지정'}</div>
                  <div className="text-sm text-white/80 self-center">{r.material_description ?? '—'}</div>
                  <div className="self-center">
                    {r.vehicle_type && (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-white/10 text-white/60">
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
// NotePanel — 슬라이드별 오버레이 메모 패널
// ────────────────────────────────────────────────────────
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
    <div className="absolute top-0 right-0 h-full w-72 bg-neutral-900/95 backdrop-blur-xl border-l border-white/10 flex flex-col z-30 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div>
          <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest">슬라이드 메모</p>
          <p className="text-xs text-white/70 mt-0.5">{SLIDES[slideIdx]?.label}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[10px] text-emerald-400">저장됨 ✓</span>}
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="이 슬라이드 관련 메모를 작성하세요.&#10;자동 저장됩니다."
        className="flex-1 resize-none bg-transparent text-sm text-white/80 placeholder-white/20 px-4 py-3 outline-none leading-relaxed"
      />
      <div className="px-4 py-2 border-t border-white/10 shrink-0">
        <p className="text-[10px] text-white/25">입력 후 자동 저장 · 브라우저 로컬에 보관</p>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// MeetingModeView — 메인 컴포넌트
// ────────────────────────────────────────────────────────
export function MeetingModeView({
  meetingId, onClose,
}: {
  meetingId: string
  onClose: () => void
}) {
  const [meeting,    setMeeting]    = useState<Meeting | null>(null)
  const [workItems,  setWorkItems]  = useState<WorkItem[]>([])
  const [slots,      setSlots]      = useState<MaterialSlot[]>([])
  const [allTeamIds, setAllTeamIds] = useState<string[]>([])
  const [loading,    setLoading]    = useState(true)

  const [slideIdx,     setSlideIdx]     = useState(0)
  const [showNote,     setShowNote]     = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // ── 데이터 로드 ──────────────────────────────────────
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

  // ── 키보드 네비게이션 ────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setSlideIdx(i => Math.min(i + 1, SLIDES.length - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setSlideIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Escape') {
        if (showNote) setShowNote(false)
        else if (isFullscreen) document.exitFullscreen?.()
        else onClose()
      } else if (e.key === 'm' || e.key === 'M') {
        setShowNote(s => !s)
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showNote, isFullscreen, onClose]) // eslint-disable-line

  // ── 전체화면 ─────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.()
    else document.exitFullscreen?.()
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const generalItems = useMemo(() => workItems.filter(w => w.work_type === 'general'), [workItems])
  const mapUrl = meeting?.map_file_url ?? null

  const materialCount = slots.reduce((acc, s) => acc + (s.material_reservations?.length ?? 0), 0)

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

  const currentSlide = SLIDES[slideIdx]

  return (
    <div ref={containerRef}
      className="fixed inset-0 bg-neutral-950 flex flex-col z-50 select-none"
      style={{ fontFamily: 'var(--font-geist-sans, system-ui)' }}>

      {/* ── 헤더 ──────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>

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
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">DABs 회의 모드</p>
            <h1 className="text-sm font-semibold text-white/90 leading-tight">{meeting?.title ?? meetingId}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <WeatherWidget />
          <div className="w-px h-5 bg-white/10" />
          <button onClick={() => setShowNote(s => !s)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              showNote ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10',
            ].join(' ')}
            title="메모 (M)">
            📝 메모
          </button>
          <button onClick={toggleFullscreen}
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

      {/* ── 슬라이드 본문 ─────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <div className={['absolute inset-0 flex flex-col transition-[right] duration-300', showNote ? 'right-72' : 'right-0'].join(' ')}>

          {/* 슬라이드 타이틀 */}
          <div className="shrink-0 flex items-center justify-between px-8 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{currentSlide.icon}</span>
              <h2 className="text-lg font-bold text-white/90">{currentSlide.label}</h2>
            </div>
            <div className="flex items-center gap-2 text-white/30 text-sm">
              <span>{slideIdx + 1}</span><span>/</span><span>{SLIDES.length}</span>
            </div>
          </div>

          {/* 슬라이드 콘텐츠 */}
          <div className="flex-1 overflow-hidden px-8 pb-4">
            {currentSlide.type === 'high_risk' ? (
              <HighRiskSlide
                meetingId={meetingId}
                mapUrl={mapUrl}
                workItems={workItems}
                allTeamIds={allTeamIds}
              />
            ) : currentSlide.type === 'work_general' ? (
              <WorkItemSlide items={generalItems} />
            ) : (
              <MaterialSlide slots={slots} />
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
              className="absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
              style={{ right: showNote ? 'calc(18rem + 0.75rem)' : '0.75rem' }}>
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

      {/* ── 하단 탭 바 ───────────────────────────────── */}
      <footer className="shrink-0 flex items-center gap-2 px-5 py-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {SLIDES.map((slide, idx) => {
          const count =
            slide.type === 'high_risk'    ? workItems.filter(w => w.work_type === 'high_risk').length :
            slide.type === 'work_general' ? workItems.filter(w => w.work_type === 'general').length   :
            materialCount

          return (
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
              {count > 0 && (
                <span className={[
                  'text-xs px-1.5 py-0.5 rounded-full font-semibold',
                  idx === slideIdx ? 'bg-neutral-900/20 text-neutral-700' : 'bg-white/15 text-white/60',
                ].join(' ')}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
        <div className="ml-auto text-[11px] text-white/20 shrink-0">
          ← → 키보드 이동 · M 메모 · F 전체화면 · Esc 닫기
        </div>
      </footer>
    </div>
  )
}
