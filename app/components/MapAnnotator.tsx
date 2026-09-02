'use client'
// ============================================================
// MapAnnotator — 지적도 위에 드래그&드롭으로 장비/작업구역 표기
// 협력업체가 자신의 장비를 지도에 올리면 실시간으로 공유됨
// ============================================================
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── 마커 타입 정의 ──────────────────────────────────────────
export const MARKER_TYPES: Record<string, { icon: string; label: string; bg: string }> = {
  excavator:   { icon: '🚜', label: '굴착기',      bg: '#FEF3C7' },
  small_exc:   { icon: '🔧', label: '소형굴착기',  bg: '#FEF3C7' },
  crane:       { icon: '🏗️', label: '크레인',      bg: '#DBEAFE' },
  dump_truck:  { icon: '🚛', label: '덤프트럭',    bg: '#F3F4F6' },
  pump_car:    { icon: '🚰', label: '펌프카',      bg: '#DCFCE7' },
  roller:      { icon: '🛞', label: '롤러',        bg: '#F3E8FF' },
  pile_driver: { icon: '⚙️', label: '항타기',      bg: '#FFE4E6' },
  loader:      { icon: '🔄', label: '로더',        bg: '#FEF9C3' },
  forklift:    { icon: '🏋️', label: '지게차',      bg: '#E0F2FE' },
  work_zone:   { icon: '⚠️', label: '작업구역',    bg: '#FEF08A' },
  personnel:   { icon: '👷', label: '인원배치',    bg: '#D1FAE5' },
  material:    { icon: '📦', label: '자재',        bg: '#E0E7FF' },
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
}

interface Props {
  meetingId: string
  mapUrl: string
  myTeamId: string          // 현재 사용자 팀 ID (관리자면 '')
  allTeamIds: string[]      // 전체 팀 순서 (색상 배정용)
  readOnly?: boolean        // 관리자 뷰: 편집 불가
  onMarkerCountChange?: (count: number) => void
  workItems?: WorkItemInfo[] // 마커 클릭 팝업용 작업항목
}

export default function MapAnnotator({
  meetingId, mapUrl, myTeamId, allTeamIds, readOnly = false, onMarkerCountChange, workItems = [],
}: Props) {
  const [markers,      setMarkers]      = useState<MapMarker[]>([])
  const [draggingType, setDraggingType] = useState<string | null>(null)
  const [labelInput,   setLabelInput]   = useState('')
  const [showLabelFor, setShowLabelFor] = useState<{type:string; x:number; y:number} | null>(null)
  const [hoverId,      setHoverId]      = useState<string | null>(null)
  const [clickedMarker, setClickedMarker] = useState<MapMarker | null>(null)
  const [filterTeamId, setFilterTeamId]   = useState<string | null>(null)   // 관리자 팀 필터
  const mapRef   = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => createClient(), [])

  // ── 마커 로드 ────────────────────────────────────────────
  const loadMarkers = useCallback(async () => {
    const res  = await fetch(`/api/map-markers?meetingId=${meetingId}`)
    const data = await res.json()
    if (Array.isArray(data)) {
      setMarkers(data)
      if (onMarkerCountChange) {
        const myCount = myTeamId
          ? (data as MapMarker[]).filter(m => m.team_id === myTeamId).length
          : (data as MapMarker[]).filter(m => !m.team_id).length
        onMarkerCountChange(myCount)
      }
    }
  }, [meetingId, myTeamId, onMarkerCountChange])

  useEffect(() => { loadMarkers() }, [loadMarkers])

  // ── Supabase Realtime 구독 ────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`map:${meetingId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'map_markers',
        filter: `meeting_id=eq.${meetingId}`,
      }, () => { loadMarkers() })
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [meetingId, supabase, loadMarkers])

  // ── 드래그&드롭 핸들러 ────────────────────────────────────
  function handleDragStart(type: string) { setDraggingType(type) }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!draggingType || !mapRef.current || readOnly) return
    const rect = mapRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setShowLabelFor({ type: draggingType, x, y })
    setLabelInput('')
    setDraggingType(null)
  }

  async function confirmPlace() {
    if (!showLabelFor) return
    const { type, x, y } = showLabelFor
    const res = await fetch('/api/map-markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_id:  meetingId,
        team_id:     myTeamId || null,
        marker_type: type,
        x_pct:       Math.round(x * 10) / 10,
        y_pct:       Math.round(y * 10) / 10,
        label:       labelInput.trim() || null,
      }),
    })
    setShowLabelFor(null)
    if (res.ok) loadMarkers()
  }

  async function deleteMarker(id: string) {
    await fetch(`/api/map-markers?id=${id}`, { method: 'DELETE' })
    setClickedMarker(null)
    setMarkers(prev => prev.filter(m => m.id !== id))
    loadMarkers()
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

  // 클릭한 마커의 업체 작업항목
  const clickedTeamItems = clickedMarker
    ? workItems.filter(w => w.team_id === (clickedMarker.team_id ?? ''))
    : []

  return (
    <div className="space-y-4">
      {/* ── 도구 패널 (업체 전용) ────────────────────────────── */}
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">
            아이콘을 지도 위에 드래그하세요
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(MARKER_TYPES).map(([type, { icon, label, bg }]) => (
              <div
                key={type}
                draggable
                onDragStart={() => handleDragStart(type)}
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
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            {readOnly ? '🗺️ 전체 협업 현황' : '🗺️ 지적도 — 내 장비/작업구역 표시'}
          </h3>
          {!readOnly && (
            <p className="text-xs text-slate-400">마커를 클릭하면 상세 정보를 볼 수 있습니다</p>
          )}
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
            src={mapUrl}
            alt="지적도"
            className="w-full h-auto block pointer-events-none"
            draggable={false}
          />

          {draggingType && (
            <div className="absolute inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400
                            flex items-center justify-center pointer-events-none z-10">
              <div className="bg-white rounded-xl px-6 py-3 shadow-lg text-sm font-semibold text-blue-600">
                {MARKER_TYPES[draggingType]?.icon} 여기에 놓으세요
              </div>
            </div>
          )}

          {/* 마커들 */}
          {visibleMarkers.map(marker => {
            const typeInfo   = MARKER_TYPES[marker.marker_type]
            const teamColor  = getTeamColor(marker.team_id ?? null)
            const isMyMarker = myTeamId
              ? marker.team_id === myTeamId
              : marker.team_id === null || marker.team_id === undefined
            const isHovered  = hoverId === marker.id

            return (
              <div
                key={marker.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 z-20"
                style={{ left: `${marker.x_pct}%`, top: `${marker.y_pct}%` }}
                onMouseEnter={() => setHoverId(marker.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => setClickedMarker(marker)}
              >
                <div className="relative flex flex-col items-center cursor-pointer transition-transform hover:scale-110">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-xl border-3 border-white"
                    style={{
                      background: typeInfo?.bg ?? '#fff',
                      boxShadow: `0 0 0 3px ${teamColor}, 0 4px 12px rgba(0,0,0,0.2)`,
                    }}
                  >
                    {typeInfo?.icon ?? '📍'}
                  </div>
                  <div
                    className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white"
                    style={{ background: teamColor }}
                  />
                  {isHovered && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2
                                    bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5
                                    whitespace-nowrap shadow-xl z-30 pointer-events-none">
                      <p className="font-semibold" style={{ color: teamColor }}>
                        {marker.teams?.name ?? (isMyMarker ? '내 마커' : '업체')}
                      </p>
                      <p>{typeInfo?.label ?? marker.marker_type}</p>
                      {marker.label && <p className="text-slate-300">{marker.label}</p>}
                      <p className="text-slate-400 text-[10px] mt-0.5">클릭하여 상세보기</p>
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

      {/* ── 라벨 입력 모달 ────────────────────────────────────── */}
      {showLabelFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center mb-4">
              <span className="text-4xl">{MARKER_TYPES[showLabelFor.type]?.icon}</span>
              <h3 className="font-semibold text-slate-800 mt-2">
                {MARKER_TYPES[showLabelFor.type]?.label} 배치
              </h3>
            </div>
            <input
              type="text"
              autoFocus
              placeholder="추가 설명 (선택) — 예) 1호 굴착기"
              value={labelInput}
              onChange={e => setLabelInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmPlace()}
              className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm outline-none
                         focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowLabelFor(null)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-50">
                취소
              </button>
              <button onClick={confirmPlace}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl">
                지도에 표시
              </button>
            </div>
          </div>
        </div>
      )}

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
                    {clickedMarker.label && (
                      <p className="text-xs text-gray-500 mt-0.5">{clickedMarker.label}</p>
                    )}
                  </div>
                </div>
                <button onClick={() => setClickedMarker(null)}
                  className="text-gray-400 hover:text-gray-600 text-lg font-medium p-1">✕</button>
              </div>
            </div>

            {/* 해당 업체 작업항목 */}
            {clickedTeamItems.length > 0 && (
              <div className="px-6 py-4 max-h-60 overflow-y-auto space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {clickedMarker.teams?.name ?? '이 업체'}의 작업 현황
                </p>
                {clickedTeamItems.map(item => (
                  <div key={item.id} className={[
                    'rounded-lg border px-3 py-2.5',
                    item.work_type === 'high_risk'
                      ? 'bg-red-50 border-red-100'
                      : 'bg-blue-50 border-blue-100',
                  ].join(' ')}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={[
                        'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase',
                        item.work_type === 'high_risk'
                          ? 'bg-red-500 text-white'
                          : 'bg-blue-500 text-white',
                      ].join(' ')}>
                        {item.work_type === 'high_risk' ? '고위험' : '일반'}
                      </span>
                      <p className="text-sm font-medium text-gray-900">{item.work_name}</p>
                    </div>
                    {(item.location || item.worker_count > 0) && (
                      <p className="text-xs text-gray-500">
                        {[item.location, item.worker_count > 0 ? `${item.worker_count}명` : ''].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {item.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {clickedTeamItems.length === 0 && (
              <div className="px-6 py-4 text-center text-gray-400 text-sm">
                등록된 작업 항목이 없습니다
              </div>
            )}

            {/* 푸터: 삭제 버튼 (내 마커 + 편집 모드) */}
            {(() => {
              const isOwn = myTeamId
                ? clickedMarker.team_id === myTeamId
                : clickedMarker.team_id === null
              return isOwn && !readOnly ? (
                <div className="px-6 pb-5 pt-2">
                  <button
                    onClick={() => deleteMarker(clickedMarker.id)}
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
