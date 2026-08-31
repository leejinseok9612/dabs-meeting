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
  team_id: string
  marker_type: string
  x_pct: number
  y_pct: number
  label?: string
  teams?: { id: string; name: string }
}

interface Props {
  meetingId: string
  mapUrl: string            // 배경 지적도 URL
  myTeamId: string          // 현재 사용자 팀 ID (관리자면 '')
  allTeamIds: string[]      // 전체 팀 순서 (색상 배정용)
  readOnly?: boolean        // 관리자 뷰: 편집 불가
}

export default function MapAnnotator({
  meetingId, mapUrl, myTeamId, allTeamIds, readOnly = false,
}: Props) {
  const [markers,      setMarkers]      = useState<MapMarker[]>([])
  const [draggingType, setDraggingType] = useState<string | null>(null)
  const [labelInput,   setLabelInput]   = useState('')
  const [showLabelFor, setShowLabelFor] = useState<{type:string; x:number; y:number} | null>(null)
  const [hoverId,      setHoverId]      = useState<string | null>(null)
  const mapRef   = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => createClient(), [])

  // ── 마커 로드 ────────────────────────────────────────────
  const loadMarkers = useCallback(async () => {
    const res  = await fetch(`/api/map-markers?meetingId=${meetingId}`)
    const data = await res.json()
    if (Array.isArray(data)) setMarkers(data)
  }, [meetingId])

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
  function handleDragStart(type: string) {
    setDraggingType(type)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!draggingType || !mapRef.current || readOnly) return

    const rect = mapRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    // 라벨 입력 팝업 표시
    setShowLabelFor({ type: draggingType, x, y })
    setLabelInput('')
    setDraggingType(null)
  }

  async function confirmPlace() {
    if (!showLabelFor) return
    const { type, x, y } = showLabelFor

    await fetch('/api/map-markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_id:  meetingId,
        team_id:     myTeamId,
        marker_type: type,
        x_pct:       Math.round(x * 10) / 10,
        y_pct:       Math.round(y * 10) / 10,
        label:       labelInput.trim() || null,
      }),
    })
    setShowLabelFor(null)
  }

  async function deleteMarker(id: string) {
    await fetch(`/api/map-markers?id=${id}`, { method: 'DELETE' })
    setMarkers(prev => prev.filter(m => m.id !== id))
  }

  function getTeamColor(teamId: string): string {
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

  return (
    <div className="space-y-4">
      {/* ── 도구 패널 (관리자 뷰에서는 숨김) ────────────────── */}
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
            <p className="text-xs text-slate-400">내 마커를 클릭하면 삭제됩니다</p>
          )}
        </div>

        {/* 지도 컨테이너 */}
        <div
          ref={mapRef}
          className="relative w-full select-none"
          style={{ minHeight: 400, background: '#f8fafc' }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* 배경 이미지 */}
          <img
            src={mapUrl}
            alt="지적도"
            className="w-full h-auto block pointer-events-none"
            draggable={false}
          />

          {/* 드롭 안내 오버레이 */}
          {draggingType && (
            <div className="absolute inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400
                            flex items-center justify-center pointer-events-none z-10">
              <div className="bg-white rounded-xl px-6 py-3 shadow-lg text-sm font-semibold text-blue-600">
                {MARKER_TYPES[draggingType]?.icon} 여기에 놓으세요
              </div>
            </div>
          )}

          {/* 마커들 */}
          {markers.map(marker => {
            const typeInfo   = MARKER_TYPES[marker.marker_type]
            const teamColor  = getTeamColor(marker.team_id)
            const isMyMarker = marker.team_id === myTeamId
            const isHovered  = hoverId === marker.id

            return (
              <div
                key={marker.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 z-20"
                style={{ left: `${marker.x_pct}%`, top: `${marker.y_pct}%` }}
                onMouseEnter={() => setHoverId(marker.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => { if (isMyMarker && !readOnly) deleteMarker(marker.id) }}
              >
                {/* 마커 아이콘 */}
                <div
                  className={[
                    'relative flex flex-col items-center cursor-pointer transition-transform',
                    isMyMarker && !readOnly ? 'hover:scale-110' : '',
                  ].join(' ')}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-xl
                               border-3 border-white"
                    style={{
                      background: typeInfo?.bg ?? '#fff',
                      boxShadow: `0 0 0 3px ${teamColor}, 0 4px 12px rgba(0,0,0,0.2)`,
                    }}
                  >
                    {typeInfo?.icon ?? '📍'}
                  </div>

                  {/* 팀 색상 점 */}
                  <div
                    className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white"
                    style={{ background: teamColor }}
                  />

                  {/* 툴팁 */}
                  {isHovered && (
                    <div
                      className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2
                                 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5
                                 whitespace-nowrap shadow-xl z-30"
                    >
                      <p className="font-semibold" style={{ color: teamColor }}>
                        {marker.teams?.name ?? '업체'}
                      </p>
                      <p>{typeInfo?.label ?? marker.marker_type}</p>
                      {marker.label && <p className="text-slate-300">{marker.label}</p>}
                      {isMyMarker && !readOnly && (
                        <p className="text-red-300 text-xs mt-0.5">클릭하여 삭제</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 지도 없을 때 안내 */}
          {!mapUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
              <p className="text-slate-400 text-sm">관리자가 지적도를 업로드하면 여기에 표시됩니다</p>
            </div>
          )}
        </div>

        {/* 범례 */}
        {teamLegend.length > 0 && (
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
    </div>
  )
}
