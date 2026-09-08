'use client'
// ============================================================
// MapAnnotator — 지적도 위에 드래그&드롭으로 장비/작업구역 표기
// 협력업체가 자신의 장비를 지도에 올리면 실시간으로 공유됨
// ✅ 드롭 즉시 마커 저장 / 내 마커 드래그로 자유 이동
// ============================================================
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── 마커 타입 정의 ──────────────────────────────────────────
export const MARKER_TYPES: Record<string, { icon: string; label: string; bg: string }> = {
  // ── 기존 장비 (이모지 개선) ───────────────────────────────
  excavator:      { icon: '⛏️', label: '굴착기',       bg: '#FEF3C7' },
  small_exc:      { icon: '🛠️', label: '소형굴착기',   bg: '#FEF3C7' },
  crane:          { icon: '🏗️', label: '크레인',       bg: '#DBEAFE' },
  tower_crane:    { icon: '🗼', label: '타워크레인',   bg: '#E0E7FF' },
  dump_truck:     { icon: '🚛', label: '덤프트럭',     bg: '#F3F4F6' },
  pump_car:       { icon: '💧', label: '펌프카',       bg: '#DCFCE7' },
  concrete_mixer: { icon: '🔄', label: '레미콘',       bg: '#E2E8F0' },
  roller:         { icon: '🛞', label: '롤러',         bg: '#F3E8FF' },
  pile_driver:    { icon: '🔨', label: '항타기',       bg: '#FFE4E6' },
  loader:         { icon: '🪣', label: '로더',         bg: '#FEF9C3' },
  forklift:       { icon: '📤', label: '지게차',       bg: '#E0F2FE' },
  aerial_lift:    { icon: '🚒', label: '고소작업차',   bg: '#FEE2E2' },
  scaffold:       { icon: '🪜', label: '비계',         bg: '#FEFCE8' },
  work_zone:      { icon: '🚧', label: '작업구역',     bg: '#FEF08A' },
  welder:         { icon: '🔥', label: '용접/절단',    bg: '#FFF7ED' },
  personnel:      { icon: '👷', label: '인원배치',     bg: '#D1FAE5' },
  material:       { icon: '📦', label: '자재',         bg: '#E0E7FF' },
}

// 팀 번호에 따라 색상 배정 (최대 6팀)
const TEAM_COLORS = ['#3B82F6','#F97316','#22C55E','#8B5CF6','#EF4444','#EC4899']

export interface MapMarker {
  id: string
  meeting_id: string
  team_id: string | null   // 관리자 마커는 null
  marker_type: string
  x_pct: number
  y_pct: number
  label?: string
  work_type?: 'high_risk' | 'general' | null
  teams?: { id: string; name: string }
}

export interface WorkItemInfo {
  id: string
  work_type: 'high_risk' | 'general'
  work_name: string
  location?: string
  worker_count: number
  description?: string
  team_id: string
  risk_factors?: string
  improvement_measures?: string
}

interface Props {
  meetingId: string
  mapUrl: string
  myTeamId: string
  allTeamIds: string[]
  readOnly?: boolean
  onMarkerCountChange?: (count: number) => void
  workItems?: WorkItemInfo[]
  workType?: 'high_risk' | 'general'
  /** @deprecated 드롭 즉시 저장으로 변경됨 — 더 이상 사용되지 않음 */
  onMarkerDrop?: (markerType: string, x: number, y: number) => void
  /** 마커 삭제 시 연결된 작업항목도 삭제 */
  onMarkerDelete?: (marker: MapMarker) => void
  /** @deprecated 드롭 즉시 저장으로 변경됨 */
  pendingDrop?: { markerType: string; x: number; y: number } | null
  /** @deprecated 드롭 즉시 저장으로 변경됨 */
  onPendingDropSaved?: () => void
  /** 작업 카드 hover 시 해당 팀 마커 강조 */
  hoveredTeamId?: string | null
  /** 새 마커가 저장된 직후 호출 — 작업항목 추가 폼 자동 오픈에 사용 */
  onMarkerDropped?: (marker: MapMarker) => void
}

export default function MapAnnotator({
  meetingId, mapUrl, myTeamId, allTeamIds, readOnly = false, onMarkerCountChange, workItems = [],
  workType, onMarkerDelete, hoveredTeamId, onMarkerDropped,
}: Props) {
  const [markers,         setMarkers]         = useState<MapMarker[]>([])
  const [draggingType,    setDraggingType]    = useState<string | null>(null)
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null)
  const [hoverId,         setHoverId]         = useState<string | null>(null)
  const [clickedMarker,   setClickedMarker]   = useState<MapMarker | null>(null)
  const [filterTeamId,    setFilterTeamId]    = useState<string | null>(null)
  const [dropRejected,    setDropRejected]    = useState(false)
  const [saving,          setSaving]          = useState(false)
  const mapRef   = useRef<HTMLDivElement>(null)
  const imgRef   = useRef<HTMLImageElement>(null)
  const supabase = useMemo(() => createClient(), [])

  // 채널 이름: workType에 따라 고유하게
  const channelName = `map_${workType ?? 'all'}:${meetingId}`

  // ── 헤더 타이틀 ──────────────────────────────────────────
  const headerTitle = workType === 'high_risk'
    ? '🗺️ 고위험작업 지적도'
    : workType === 'general'
      ? '🗺️ 일반작업 지적도'
      : readOnly
        ? '🗺️ 전체 협업 현황'
        : '🗺️ 지적도 — 내 장비/작업구역 표시'

  // ── 마커 로드 ────────────────────────────────────────────
  const loadMarkers = useCallback(async () => {
    const res  = await fetch(`/api/map-markers?meetingId=${meetingId}`)
    const data = await res.json()
    if (Array.isArray(data)) {
      const filtered = workType
        ? (data as MapMarker[]).filter(m => m.work_type === workType)
        : (data as MapMarker[])
      setMarkers(filtered)
      if (onMarkerCountChange) {
        const myCount = myTeamId
          ? filtered.filter(m => m.team_id === myTeamId).length
          : filtered.filter(m => !m.team_id).length
        onMarkerCountChange(myCount)
      }
    }
  }, [meetingId, myTeamId, onMarkerCountChange, workType])

  useEffect(() => { loadMarkers() }, [loadMarkers])

  // ── Supabase Realtime 구독 ────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'map_markers',
        filter: `meeting_id=eq.${meetingId}`,
      }, () => { loadMarkers() })
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [meetingId, supabase, loadMarkers, channelName])

  // ── 드래그 핸들러 ─────────────────────────────────────────
  function handleDragStart(type: string) {
    setDraggingType(type)
    setDraggingMarkerId(null)
  }

  function handleMarkerDragStart(e: React.DragEvent, markerId: string) {
    e.stopPropagation()
    setDraggingMarkerId(markerId)
    setDraggingType(null)
    // ghost image 최소화
    const ghost = document.createElement('div')
    ghost.style.opacity = '0'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  function handleDragEnd() { setDraggingMarkerId(null); setDraggingType(null) }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!mapRef.current || readOnly) return
    const rect = mapRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    // ── 기존 마커 이동 ────────────────────────────────────
    if (draggingMarkerId) {
      const rx = Math.round(x * 10) / 10
      const ry = Math.round(y * 10) / 10
      // 즉시 UI 반영
      setMarkers(prev => prev.map(m =>
        m.id === draggingMarkerId ? { ...m, x_pct: rx, y_pct: ry } : m
      ))
      setDraggingMarkerId(null)
      // API 저장
      await fetch('/api/map-markers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draggingMarkerId, x_pct: rx, y_pct: ry }),
      })
      return
    }

    if (!draggingType) return

    // ── 지적도 경계 검사 ──────────────────────────────────
    const imgEl = imgRef.current
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      try {
        const canvas = document.createElement('canvas')
        canvas.width  = imgEl.naturalWidth
        canvas.height = imgEl.naturalHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(imgEl, 0, 0)
          const px = Math.round(((e.clientX - rect.left) / rect.width)  * imgEl.naturalWidth)
          const py = Math.round(((e.clientY - rect.top)  / rect.height) * imgEl.naturalHeight)
          const pixel = ctx.getImageData(px, py, 1, 1).data
          const [r, g, b, a] = [pixel[0], pixel[1], pixel[2], pixel[3]]
          if (a < 30 || (r > 225 && g > 225 && b > 225)) {
            setDropRejected(true)
            setTimeout(() => setDropRejected(false), 1800)
            setDraggingType(null)
            return
          }
        }
      } catch (_) { /* CORS 등 접근 실패 → 제한 없이 허용 */ }
    }

    // ── 즉시 마커 저장 ────────────────────────────────────
    const body: Record<string, unknown> = {
      meeting_id:  meetingId,
      team_id:     myTeamId || null,
      marker_type: draggingType,
      x_pct:       Math.round(x * 10) / 10,
      y_pct:       Math.round(y * 10) / 10,
      label:       MARKER_TYPES[draggingType]?.label ?? draggingType,
    }
    if (workType) body.work_type = workType
    setDraggingType(null)
    setSaving(true)
    const res = await fetch('/api/map-markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const newMarker: MapMarker = await res.json()
      setMarkers(prev => {
        const updated = [...prev, newMarker]
        if (onMarkerCountChange) {
          onMarkerCountChange(updated.filter(m => m.team_id === myTeamId).length)
        }
        return updated
      })
      // 새 마커 저장 성공 → 작업항목 추가 폼 자동 오픈 트리거
      onMarkerDropped?.(newMarker)
    }
    setSaving(false)
  }

  async function deleteMarker(marker: MapMarker) {
    onMarkerDelete?.(marker)
    await fetch(`/api/map-markers?id=${marker.id}`, { method: 'DELETE' })
    setClickedMarker(null)
    setMarkers(prev => {
      const updated = prev.filter(m => m.id !== marker.id)
      if (onMarkerCountChange) {
        onMarkerCountChange(updated.filter(m => m.team_id === myTeamId).length)
      }
      return updated
    })
  }

  function getTeamColor(teamId: string | null): string {
    if (!teamId) return '#6B7280'
    const idx = allTeamIds.indexOf(teamId)
    return TEAM_COLORS[idx >= 0 ? idx % TEAM_COLORS.length : 0]
  }

  // 팀별 범례
  const teamLegend = allTeamIds
    .map((id, i) => {
      const sample = markers.find(m => m.team_id === id)
      const name   = sample?.teams?.name ?? `업체 ${i + 1}`
      const count  = markers.filter(m => m.team_id === id).length
      return { id, name, color: TEAM_COLORS[i % TEAM_COLORS.length], count }
    })
    .filter(t => t.count > 0)

  // 필터 적용된 마커 목록
  const visibleMarkers = filterTeamId
    ? markers.filter(m => m.team_id === filterTeamId)
    : markers

  // 클릭한 마커에 연결된 작업항목 — 3단계 매칭
  const clickedTeamItems = useMemo(() => {
    if (!clickedMarker) return []
    const tid = clickedMarker.team_id ?? ''

    // 1순위: label === work_name 정확 매칭
    const exact = workItems.filter(w => w.team_id === tid && w.work_name === clickedMarker.label)
    if (exact.length) return exact

    // 2순위: 부분 매칭
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

    // 3순위: 같은 team + work_type이 정확히 1건일 때만
    if (clickedMarker.work_type) {
      const byType = workItems.filter(w => w.team_id === tid && w.work_type === clickedMarker.work_type)
      if (byType.length === 1) return byType
    }

    return []
  }, [clickedMarker, workItems])

  return (
    <div className="space-y-4">
      {/* ── 도구 패널 (업체 전용) ────────────────────────────── */}
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">
            아이콘을 지도 위에 드래그하세요 — 즉시 표시됩니다
            {workType === 'high_risk' && (
              <span className="ml-2 text-red-500 normal-case font-normal">· 등록 후 드래그로 위치 조정 가능</span>
            )}
            {workType === 'general' && (
              <span className="ml-2 text-blue-500 normal-case font-normal">· 등록 후 드래그로 위치 조정 가능</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(MARKER_TYPES).map(([type, { icon, label, bg }]) => (
              <div
                key={type}
                draggable
                onDragStart={() => handleDragStart(type)}
                onDragEnd={handleDragEnd}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl border border-slate-200
                           cursor-grab active:cursor-grabbing select-none hover:shadow-md transition-all
                           hover:-translate-y-0.5"
                style={{ background: bg }}
              >
                <span className="text-2xl">{icon}</span>
                <span className="text-xs font-medium text-slate-600">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 지도 영역 ────────────────────────────────────────── */}
      <div className={[
        'bg-white rounded-xl border overflow-hidden',
        workType === 'high_risk' ? 'border-red-200' : workType === 'general' ? 'border-blue-200' : 'border-slate-200',
      ].join(' ')}>
        <div className={[
          'px-4 py-3 border-b flex items-center justify-between',
          workType === 'high_risk' ? 'border-red-100 bg-red-50' : workType === 'general' ? 'border-blue-100 bg-blue-50' : 'border-slate-100',
        ].join(' ')}>
          <h3 className={[
            'text-sm font-semibold',
            workType === 'high_risk' ? 'text-red-700' : workType === 'general' ? 'text-blue-700' : 'text-slate-700',
          ].join(' ')}>
            {headerTitle}
          </h3>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full"
                  style={{ animation: 'spin 0.8s linear infinite' }} />
                저장 중…
              </span>
            )}
            {!readOnly && (
              <p className="text-xs text-slate-400">
                내 마커는 드래그로 이동 · 클릭으로 상세보기
              </p>
            )}
          </div>
        </div>

        {/* 관리자 팀 필터 */}
        {readOnly && teamLegend.length > 0 && (
          <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-2 bg-slate-50">
            <button
              onClick={() => setFilterTeamId(null)}
              className={[
                'text-xs font-medium px-3 py-1 rounded-full transition-colors',
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
                className={[
                  'text-xs font-medium px-3 py-1 rounded-full transition-colors flex items-center gap-1.5',
                  filterTeamId === t.id
                    ? 'text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400',
                ].join(' ')}
                style={filterTeamId === t.id ? { backgroundColor: t.color, borderColor: t.color } : {}}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                {t.name} ({t.count})
              </button>
            ))}
          </div>
        )}

        {/* 지도 컨테이너 */}
        <div
          ref={mapRef}
          className="relative w-full select-none"
          style={{ minHeight: 400, background: '#f8fafc' }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <img
            ref={imgRef}
            src={mapUrl}
            alt="지적도"
            className="w-full h-auto block pointer-events-none"
            draggable={false}
            crossOrigin="anonymous"
          />

          {/* 새 마커 드롭 힌트 */}
          {draggingType && !draggingMarkerId && (
            <div className="absolute inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400
                            flex items-center justify-center pointer-events-none z-10">
              <div className="bg-white rounded-xl px-6 py-3 shadow-lg text-sm font-semibold text-blue-600">
                {MARKER_TYPES[draggingType]?.icon} 지적도 위에 놓으세요 — 즉시 저장됩니다
              </div>
            </div>
          )}

          {/* 기존 마커 이동 힌트 */}
          {draggingMarkerId && (
            <div className="absolute inset-0 bg-amber-400/10 border-4 border-dashed border-amber-400
                            flex items-center justify-center pointer-events-none z-10">
              <div className="bg-white rounded-xl px-6 py-3 shadow-lg text-sm font-semibold text-amber-700">
                원하는 위치에 놓으세요
              </div>
            </div>
          )}

          {/* 드롭 거부 피드백 */}
          {dropRejected && (
            <div className="absolute inset-0 bg-red-500/15 border-4 border-red-400
                            flex items-center justify-center pointer-events-none z-20 animate-pulse">
              <div className="bg-white rounded-xl px-6 py-3 shadow-xl text-sm font-semibold text-red-600
                              flex items-center gap-2">
                <span className="text-lg">🚫</span>
                지적도 위에만 마커를 놓을 수 있습니다
              </div>
            </div>
          )}

          {/* 마커들 */}
          {visibleMarkers.map(marker => {
            const typeInfo    = MARKER_TYPES[marker.marker_type]
            const teamColor   = getTeamColor(marker.team_id ?? null)
            const isMyMarker  = myTeamId
              ? marker.team_id === myTeamId
              : marker.team_id === null || marker.team_id === undefined
            const isHovered     = hoverId === marker.id
            const isHighlighted = hoveredTeamId != null && marker.team_id === hoveredTeamId
            const isDimmed      = hoveredTeamId != null && marker.team_id !== hoveredTeamId
            const isBeingMoved  = draggingMarkerId === marker.id

            return (
              <div
                key={marker.id}
                className="absolute"
                draggable={isMyMarker && !readOnly}
                onDragStart={isMyMarker && !readOnly
                  ? (e) => handleMarkerDragStart(e, marker.id)
                  : undefined}
                onDragEnd={handleDragEnd}
                style={{
                  left: `${marker.x_pct}%`,
                  top:  `${marker.y_pct}%`,
                  transform: `translate(-50%, -50%) scale(${isHighlighted ? 1.4 : 1})`,
                  transition: isBeingMoved ? 'none' : 'opacity 0.15s ease, transform 0.15s ease',
                  opacity: isBeingMoved ? 0.25 : isDimmed ? 0.15 : 1,
                  zIndex: isHighlighted ? 30 : 20,
                  cursor: isMyMarker && !readOnly ? 'grab' : 'pointer',
                }}
                onMouseEnter={() => setHoverId(marker.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => { if (!draggingMarkerId) setClickedMarker(marker) }}
              >
                {/* 펄스 링 */}
                {isHighlighted && (
                  <div
                    className="absolute rounded-full animate-ping pointer-events-none"
                    style={{ inset: '-10px', background: 'rgba(250, 204, 21, 0.5)' }}
                  />
                )}
                {/* 내 마커 이동 힌트 링 */}
                {isMyMarker && !readOnly && !isBeingMoved && (
                  <div
                    className="absolute rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ inset: '-4px', border: '2px dashed rgba(255,255,255,0.6)', borderRadius: '50%' }}
                  />
                )}
                <div className="relative flex flex-col items-center transition-transform hover:scale-110">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-xl border-3 border-white"
                    style={{
                      background: typeInfo?.bg ?? '#fff',
                      boxShadow: isHighlighted
                        ? `0 0 0 3px ${teamColor}, 0 0 16px 4px rgba(250,204,21,0.6), 0 4px 12px rgba(0,0,0,0.2)`
                        : `0 0 0 3px ${teamColor}, 0 4px 12px rgba(0,0,0,0.2)`,
                    }}
                  >
                    {typeInfo?.icon ?? '📍'}
                  </div>
                  <div
                    className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white"
                    style={{ background: teamColor }}
                  />
                  {/* 이동 가능 표시 (내 마커 hover 시) */}
                  {isMyMarker && !readOnly && isHovered && !isBeingMoved && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full shadow flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </div>
                  )}
                  {isHovered && !isBeingMoved && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2
                                    bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5
                                    whitespace-nowrap shadow-xl z-30 pointer-events-none">
                      <p className="font-semibold" style={{ color: teamColor }}>
                        {marker.teams?.name ?? (isMyMarker ? '내 마커' : '업체')}
                      </p>
                      <p>{typeInfo?.label ?? marker.marker_type}</p>
                      {marker.label && marker.label !== (typeInfo?.label ?? '') && (
                        <p className="text-slate-300">{marker.label}</p>
                      )}
                      {isMyMarker && !readOnly && (
                        <p className="text-slate-400 text-[10px] mt-0.5">드래그로 이동 · 클릭으로 삭제</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {!mapUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
              <p className="text-slate-400 text-sm">관리자가 지적도를 업로드하면 여기에 표시됩니다</p>
            </div>
          )}
        </div>

        {/* 범례 */}
        {teamLegend.length > 0 && !readOnly && (
          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-3">
            {teamLegend.map(t => (
              <div key={t.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                <div className="w-3 h-3 rounded-full" style={{ background: t.color }} />
                <span className="font-medium">{t.name}</span>
                <span className="text-slate-400">({t.count}개)</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 마커 클릭 상세 팝업 ───────────────────────────────── */}
      {clickedMarker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={e => { if (e.target === e.currentTarget) setClickedMarker(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            {/* 헤더 */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow"
                    style={{
                      background: MARKER_TYPES[clickedMarker.marker_type]?.bg ?? '#f3f4f6',
                      boxShadow: `0 0 0 3px ${getTeamColor(clickedMarker.team_id)}`,
                    }}
                  >
                    {MARKER_TYPES[clickedMarker.marker_type]?.icon ?? '📍'}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">
                      {MARKER_TYPES[clickedMarker.marker_type]?.label ?? clickedMarker.marker_type}
                    </p>
                    <p className="text-sm font-medium" style={{ color: getTeamColor(clickedMarker.team_id) }}>
                      {clickedMarker.teams?.name ?? '알 수 없는 업체'}
                    </p>
                    {clickedMarker.work_type && (
                      <span className={[
                        'text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block',
                        clickedMarker.work_type === 'high_risk' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600',
                      ].join(' ')}>
                        {clickedMarker.work_type === 'high_risk' ? '고위험 작업' : '일반 작업'}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setClickedMarker(null)}
                  className="text-gray-400 hover:text-gray-600 text-lg font-medium p-1">✕</button>
              </div>
            </div>

            {/* 연결된 작업항목 */}
            {clickedTeamItems.length > 0 ? (
              <div className="px-5 py-4 space-y-3 max-h-72 overflow-y-auto">
                {clickedTeamItems.map(item => (
                  <div key={item.id} className="rounded-xl overflow-hidden"
                    style={{
                      border: item.work_type === 'high_risk' ? '1px solid rgba(252,165,165,0.5)' : '1px solid rgba(147,197,253,0.5)',
                    }}>
                    <div className="px-3.5 py-2.5"
                      style={{ background: item.work_type === 'high_risk' ? 'rgba(254,242,242,0.7)' : 'rgba(239,246,255,0.7)' }}>
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
                      <div className="px-3.5 py-2 border-t border-amber-100 bg-amber-50/60">
                        <p className="text-[10px] font-semibold text-amber-600 mb-0.5">⚠ 위험요인</p>
                        <p className="text-[11px] text-amber-800 leading-relaxed">{item.risk_factors}</p>
                      </div>
                    )}
                    {item.improvement_measures && (
                      <div className="px-3.5 py-2 border-t border-emerald-100 bg-emerald-50/60">
                        <p className="text-[10px] font-semibold text-emerald-600 mb-0.5">✅ 개선대책</p>
                        <p className="text-[11px] text-emerald-800 leading-relaxed">{item.improvement_measures}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-4 text-center text-neutral-400 text-xs">
                연결된 작업항목이 없습니다
              </div>
            )}

            {/* 푸터 */}
            {(() => {
              const isOwn = myTeamId
                ? clickedMarker.team_id === myTeamId
                : clickedMarker.team_id === null
              return isOwn && !readOnly ? (
                <div className="px-6 pb-5 pt-2">
                  <button
                    onClick={() => deleteMarker(clickedMarker)}
                    className="w-full py-2.5 bg-red-50 hover:bg-red-100 border border-red-200
                               text-red-600 text-sm font-medium rounded-xl transition-colors"
                  >
                    이 마커 삭제
                  </button>
                </div>
              ) : (
                <div className="px-6 pb-5 pt-2">
                  <button onClick={() => setClickedMarker(null)}
                    className="w-full py-2.5 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                    닫기
                  </button>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
