/**
 * 겹치는 마커를 원형으로 자동 분산 배치
 *
 * 드래그/클릭 이벤트는 원본 x_pct/y_pct를 그대로 유지하고,
 * 렌더링 위치만 displayX/displayY 로 분리합니다.
 *
 * groupSize > 1 인 마커는 "겹침 그룹" 소속이므로
 * 라벨 대신 groupIndex 번호 뱃지를 표시하는 용도로 활용하세요.
 *
 * @param markers    위치 정보를 가진 마커 배열
 * @param threshold  이 %거리 이내이면 "겹침"으로 판단 (기본 5)
 * @param baseOffset 분산 반경 기준값 (기본 5, 마커 수에 비례해 자동 증가)
 */
export function spreadMarkers<T extends { x_pct: number; y_pct: number }>(
  markers: T[],
  threshold = 5,
  baseOffset = 5
): (T & { displayX: number; displayY: number; groupIndex: number; groupSize: number })[] {
  const result = markers.map(m => ({
    ...m,
    displayX:   m.x_pct,
    displayY:   m.y_pct,
    groupIndex: 1,   // 그룹 내 순번 (1-based)
    groupSize:  1,   // 단독 마커는 1
  }))

  const done = new Array(markers.length).fill(false)

  markers.forEach((m, i) => {
    if (done[i]) return

    // i 와 가까운 마커들을 같은 그룹으로 묶음
    const group: number[] = [i]
    markers.forEach((m2, j) => {
      if (i === j || done[j]) return
      if (
        Math.abs(m.x_pct - m2.x_pct) < threshold &&
        Math.abs(m.y_pct - m2.y_pct) < threshold
      ) {
        group.push(j)
      }
    })
    group.forEach(k => { done[k] = true })

    // 단독 마커는 분산 불필요 (groupSize=1 그대로)
    if (group.length < 2) return

    // 그룹 중심점
    const cx = group.reduce((s, k) => s + markers[k].x_pct, 0) / group.length
    const cy = group.reduce((s, k) => s + markers[k].y_pct, 0) / group.length

    // 마커 수에 비례해 반경 증가 (2개→5%, 3개→7.5%, 4개→10% …)
    const r = Math.max(baseOffset, baseOffset * group.length / 2)

    // 12시 방향부터 시계방향으로 배치
    group.forEach((k, n) => {
      const angle = (n * 2 * Math.PI / group.length) - Math.PI / 2
      result[k].displayX   = cx + r * Math.cos(angle)
      result[k].displayY   = cy + r * Math.sin(angle)
      result[k].groupIndex = n + 1          // 1-based
      result[k].groupSize  = group.length
    })
  })

  return result
}
