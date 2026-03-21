// ============================================================
// lib/pdf/generateCover.ts
// 표지 PDF 생성 — A4 가로 (Landscape)
// SVG → PNG (sharp) → PDF (pdf-lib)
// ============================================================
import sharp            from 'sharp'
import { PDFDocument }  from 'pdf-lib'

export interface PersonnelDetail {
  elderly:      number   // 고령자
  superElderly: number   // 초고령자
  foreign:      number   // 외국인 근로자
  female:       number   // 여성 근로자
  diseased:     number   // 유질환자
}

export interface CoverRow {
  teamName:        string
  workProcess:     string
  personnelCount:  number | null
  personnelDetail: PersonnelDetail | null
  equipment:       string  // "굴착기 10대, 집게차 2대" 형식
}

// "굴착기 10대, 집게차 2대" → {굴착기: 10, 집게차: 2}
function parseEquipment(eq: string): Record<string, number> {
  const result: Record<string, number> = {}
  if (!eq) return result
  for (const part of eq.split(',')) {
    const m = part.trim().match(/^(.+?)\s+(\d+)대$/)
    if (m) result[m[1].trim()] = (result[m[1].trim()] ?? 0) + Number(m[2])
  }
  return result
}

// 모든 업체 장비 합산
function totalEquipment(rows: CoverRow[]): string {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    const parsed = parseEquipment(row.equipment)
    for (const [type, cnt] of Object.entries(parsed)) {
      totals[type] = (totals[type] ?? 0) + cnt
    }
  }
  return Object.entries(totals).map(([t, c]) => `${t} ${c}대`).join(', ') || '—'
}

// A4 Landscape px (96dpi): 297mm × 210mm
const W = 1123
const H = 794

const KR_FONT = 'Apple SD Gothic Neo, AppleSDGothicNeo-Medium, Malgun Gothic, NanumGothic, sans-serif'

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 텍스트를 쉼표·공백 경계에서 줄바꿈해서 SVG <text> 요소 반환
 * - maxChars: 한 줄 최대 글자 수
 * - maxLines: 최대 줄 수 (초과 시 말줄임)
 * - cy: 셀 수직 중심 y좌표
 */
function wrapText(
  text: string,
  x: number,
  cy: number,
  maxChars: number,
  fontSize: number,
  fill: string,
  fontWeight = '400',
  maxLines = 3,
): string {
  const attr = `font-family="${KR_FONT}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}"`
  const lineH = fontSize * 1.5

  // 한 줄에 들어오면 단순 출력
  if (text.length <= maxChars) {
    return `<text x="${x}" y="${cy + fontSize * 0.4}" ${attr}>${escXml(text)}</text>`
  }

  // 쉼표·공백 경계에서 줄 나누기
  const lines: string[] = []
  let remaining = text.trim()

  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxChars) {
      lines.push(remaining)
      break
    }
    // maxChars 위치에서 역방향으로 쉼표/공백 탐색
    let splitAt = maxChars
    for (let i = maxChars; i >= Math.max(maxChars - 8, 1); i--) {
      if (remaining[i] === ',' || remaining[i] === ' ') {
        splitAt = i + 1  // 구분자를 현재 줄에 포함
        break
      }
    }
    lines.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  // 마지막 줄에 남은 텍스트 추가 (말줄임)
  if (remaining.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = last.length + remaining.length + 1 > maxChars
      ? last.slice(0, maxChars - 2) + '…'
      : last + ' ' + remaining
  }

  // 여러 줄 수직 중앙 정렬
  const totalH  = (lines.length - 1) * lineH
  const startY  = cy - totalH / 2 + fontSize * 0.4

  return lines
    .map((line, i) =>
      `<text x="${x}" y="${startY + i * lineH}" ${attr}>${escXml(line)}</text>`,
    )
    .join('\n  ')
}

function buildSvg(rows: CoverRow[], dateStr: string, totalEquip: string): string {
  // ── 레이아웃 상수 ────────────────────────────────────────
  const PAD     = 60
  const BAND    = 12
  const TABLE_X = PAD
  const TABLE_W = W - PAD * 2

  // 헤더 y 좌표 (겹침 방지를 위해 충분한 간격 확보)
  const LABEL_Y   = BAND + 44       // 기관 라벨 원 중심 y
  const DAILY_Y   = LABEL_Y + 22   // "DAILY ACTIVITY BRIEFING" 베이스라인
  const TITLE_Y   = DAILY_Y + 58   // 메인 제목 베이스라인 (42px 폰트 → 위쪽 ascender ~34px 확보)
  const ACCENT_Y  = TITLE_Y + 16   // 파란 액센트 바
  const DIVIDER_Y = ACCENT_Y + 18  // 수평 구분선

  // 테이블 y 좌표
  const TBL_LABEL_Y = DIVIDER_Y + 26
  const HEAD_Y      = TBL_LABEL_Y + 22
  const HEAD_H      = 42
  const TOTAL_H     = 44

  // 행 높이: 남은 세로 공간을 업체 수로 나눔 (하단 여백 55px)
  const ROW_H = Math.floor((H - HEAD_Y - HEAD_H - TOTAL_H - 55) / rows.length)

  // 컬럼 비율: 업체명 18% | 작업공정 30% | 투입인원 13% | 투입장비 나머지
  const COL_W = [
    Math.round(TABLE_W * 0.18),   // 업체명
    Math.round(TABLE_W * 0.30),   // 작업공정
    Math.round(TABLE_W * 0.13),   // 투입인원
    0,                             // 투입장비 (나머지)
  ]
  COL_W[3] = TABLE_W - COL_W[0] - COL_W[1] - COL_W[2]

  const COL_X = [
    TABLE_X,
    TABLE_X + COL_W[0],
    TABLE_X + COL_W[0] + COL_W[1],
    TABLE_X + COL_W[0] + COL_W[1] + COL_W[2],
  ]

  // 컬럼 폭 기반으로 줄당 최대 글자 수 계산 (한글 1자 ≈ 14px)
  const FONT_PX    = 14
  const CELL_PAD   = 20   // 좌우 패딩 합계
  const MAX_PROCESS = Math.floor((COL_W[1] - CELL_PAD) / FONT_PX)   // 작업공정
  const MAX_EQUIP   = Math.floor((COL_W[3] - CELL_PAD) / FONT_PX)   // 투입장비

  // ── 데이터 행 SVG ─────────────────────────────────────
  const rowsSvg = rows.map((r, i) => {
    const ry = HEAD_Y + HEAD_H + i * ROW_H
    const cy = ry + ROW_H / 2
    const bg = i % 2 === 0 ? '#F8FAFC' : '#FFFFFF'

    // 투입인원 배지 크기
    const badge_w = 76
    const badge_h = 30
    const badge_x = COL_X[2] + (COL_W[2] - badge_w) / 2
    const badge_cy = cy

    return `
  <rect x="${TABLE_X}" y="${ry}" width="${TABLE_W}" height="${ROW_H}" fill="${bg}"/>
  <line x1="${TABLE_X}" y1="${ry + ROW_H}" x2="${TABLE_X + TABLE_W}" y2="${ry + ROW_H}" stroke="#E2E8F0" stroke-width="1"/>
  <!-- 세로 구분선 -->
  <line x1="${COL_X[1]}" y1="${ry}" x2="${COL_X[1]}" y2="${ry + ROW_H}" stroke="#EEF2F7" stroke-width="1"/>
  <line x1="${COL_X[2]}" y1="${ry}" x2="${COL_X[2]}" y2="${ry + ROW_H}" stroke="#EEF2F7" stroke-width="1"/>
  <line x1="${COL_X[3]}" y1="${ry}" x2="${COL_X[3]}" y2="${ry + ROW_H}" stroke="#EEF2F7" stroke-width="1"/>
  <!-- 업체명 -->
  <text x="${COL_X[0] + 14}" y="${cy + 6}"
    font-family="${KR_FONT}" font-size="15" font-weight="700" fill="#0F172A">${escXml(r.teamName)}</text>
  <!-- 작업공정 -->
  ${wrapText(r.workProcess || '—', COL_X[1] + 14, cy, MAX_PROCESS, FONT_PX, r.workProcess ? '#1E293B' : '#94A3B8')}
  <!-- 투입인원 배지 + 세부 내역 -->
  ${r.personnelCount != null ? (() => {
    const d = r.personnelDetail
    const items: string[] = []
    if (d) {
      if (d.elderly      > 0) items.push(`고령 ${d.elderly}`)
      if (d.superElderly > 0) items.push(`초고령 ${d.superElderly}`)
      if (d.foreign      > 0) items.push(`외국인 ${d.foreign}`)
      if (d.female       > 0) items.push(`여성 ${d.female}`)
      if (d.diseased     > 0) items.push(`유질환 ${d.diseased}`)
    }
    const hasDetail = items.length > 0
    // 세부내역이 있으면 배지를 위로 올려서 세부내역 텍스트 공간 확보
    const shiftUp = hasDetail ? 10 : 0
    const badgeY = badge_cy - badge_h / 2 - shiftUp

    // 세부내역을 두 줄로 나누기 (최대 3개씩)
    const row1 = items.slice(0, 3).join('  ')
    const row2 = items.slice(3).join('  ')

    return `
  <rect x="${badge_x}" y="${badgeY}" width="${badge_w}" height="${badge_h}" rx="${badge_h / 2}" fill="#EFF6FF"/>
  <text x="${badge_x + badge_w / 2}" y="${badgeY + badge_h / 2 + 5}"
    font-family="${KR_FONT}" font-size="15" font-weight="700" fill="#1D4ED8" text-anchor="middle"
    >${r.personnelCount}<tspan font-size="11" font-weight="400" fill="#60A5FA" dx="1">명</tspan></text>
  ${hasDetail ? `
  <text x="${COL_X[2] + COL_W[2] / 2}" y="${badgeY + badge_h + 12}"
    font-family="${KR_FONT}" font-size="9.5" fill="#64748B" text-anchor="middle">${escXml(row1)}</text>
  ${row2 ? `<text x="${COL_X[2] + COL_W[2] / 2}" y="${badgeY + badge_h + 23}"
    font-family="${KR_FONT}" font-size="9.5" fill="#64748B" text-anchor="middle">${escXml(row2)}</text>` : ''}
  ` : ''}
  `})()
   : `<text x="${COL_X[2] + 14}" y="${cy + 6}"
    font-family="${KR_FONT}" font-size="14" fill="#94A3B8">—</text>`}
  <!-- 투입장비 -->
  ${wrapText(r.equipment || '—', COL_X[3] + 14, cy, MAX_EQUIP, FONT_PX, r.equipment ? '#1E293B' : '#94A3B8')}
    `.trim()
  }).join('\n')

  // 합계 행 y
  const TOTAL_Y = HEAD_Y + HEAD_H + rows.length * ROW_H
  const total_cy = TOTAL_Y + TOTAL_H / 2

  const totalPersonnel = rows.reduce((s, r) => s + (r.personnelCount ?? 0), 0)

  const badge_w = 76
  const badge_h = 30
  const badge_x = COL_X[2] + (COL_W[2] - badge_w) / 2

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">

  <!-- 배경 -->
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>

  <defs>
    <linearGradient id="gTop" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#1E3A5F"/>
      <stop offset="50%"  stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#1E3A5F"/>
    </linearGradient>
    <linearGradient id="gBot" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#2563EB"/>
      <stop offset="100%" stop-color="#1E3A5F"/>
    </linearGradient>
    <linearGradient id="gDiv" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#E2E8F0"/>
      <stop offset="50%"  stop-color="#CBD5E1"/>
      <stop offset="100%" stop-color="#E2E8F0"/>
    </linearGradient>
  </defs>

  <!-- 상단 컬러 바 -->
  <rect x="0" y="0" width="${W}" height="${BAND}" fill="url(#gTop)"/>

  <!-- 기관 라벨 -->
  <circle cx="${PAD + 6}" cy="${LABEL_Y}" r="5" fill="#2563EB"/>
  <text x="${PAD + 20}" y="${LABEL_Y + 5}"
    font-family="${KR_FONT}" font-size="12" font-weight="600" fill="#64748B" letter-spacing="1">
    THE H 한남 현장 DABs
  </text>

  <!-- DAILY ACTIVITY BRIEFING 부제목 -->
  <text x="${PAD}" y="${DAILY_Y}"
    font-family="${KR_FONT}" font-size="11" font-weight="600" fill="#2563EB" letter-spacing="2">
    DAILY ACTIVITY BRIEFING
  </text>

  <!-- 메인 제목 (DAILY ACTIVITY BRIEFING 베이스라인 + 58px → 겹침 없음) -->
  <text x="${PAD}" y="${TITLE_Y}"
    font-family="${KR_FONT}" font-size="42" font-weight="900" fill="#0F172A">
    THE H 한남 DABs 회의
  </text>

  <!-- 파란 액센트 바 -->
  <rect x="${PAD}" y="${ACCENT_Y}" width="52" height="5" rx="2.5" fill="#2563EB"/>

  <!-- 구분선 -->
  <rect x="${PAD}" y="${DIVIDER_Y}" width="${TABLE_W}" height="1" fill="url(#gDiv)"/>

  <!-- 테이블 섹션 라벨 -->
  <text x="${TABLE_X}" y="${TBL_LABEL_Y + 12}"
    font-family="${KR_FONT}" font-size="11" font-weight="700" fill="#94A3B8" letter-spacing="1">
    공종별 투입 현황
  </text>

  <!-- 테이블 헤더 -->
  <rect x="${TABLE_X}" y="${HEAD_Y}" width="${TABLE_W}" height="${HEAD_H}" fill="#1E3A5F" rx="4"/>
  <text x="${COL_X[0] + 14}" y="${HEAD_Y + 27}"
    font-family="${KR_FONT}" font-size="13" font-weight="700" fill="#FFFFFF">업체명</text>
  <text x="${COL_X[1] + 14}" y="${HEAD_Y + 27}"
    font-family="${KR_FONT}" font-size="13" font-weight="700" fill="#FFFFFF">작업공정</text>
  <text x="${COL_X[2] + (COL_W[2] / 2)}" y="${HEAD_Y + 27}"
    font-family="${KR_FONT}" font-size="13" font-weight="700" fill="#FFFFFF" text-anchor="middle">투입인원</text>
  <text x="${COL_X[3] + 14}" y="${HEAD_Y + 27}"
    font-family="${KR_FONT}" font-size="13" font-weight="700" fill="#FFFFFF">투입장비</text>

  <!-- 데이터 행 -->
  ${rowsSvg}

  <!-- 합계 행 -->
  <rect x="${TABLE_X}" y="${TOTAL_Y}" width="${TABLE_W}" height="${TOTAL_H}" fill="#EFF6FF"/>
  <line x1="${TABLE_X}" y1="${TOTAL_Y}" x2="${TABLE_X + TABLE_W}" y2="${TOTAL_Y}" stroke="#1E3A5F" stroke-width="1.5"/>
  <text x="${COL_X[0] + 14}" y="${total_cy + 6}"
    font-family="${KR_FONT}" font-size="13" font-weight="700" fill="#1E3A5F">합  계</text>

  <!-- 합계 투입인원 배지 -->
  <rect x="${badge_x}" y="${total_cy - badge_h / 2}" width="${badge_w}" height="${badge_h}" rx="${badge_h / 2}" fill="#DBEAFE"/>
  <text x="${badge_x + badge_w / 2}" y="${total_cy + 5}"
    font-family="${KR_FONT}" font-size="15" font-weight="700" fill="#1D4ED8" text-anchor="middle"
    >${totalPersonnel}<tspan font-size="11" font-weight="400" fill="#60A5FA" dx="1">명</tspan></text>

  <!-- 합계 투입장비 -->
  ${wrapText(totalEquip, COL_X[3] + 14, total_cy, MAX_EQUIP, 13, '#1E3A5F', '700', 2)}

  <!-- 하단 구분선 -->
  <rect x="0" y="${H - 46}" width="${W}" height="2" fill="#1E3A5F"/>

  <!-- 하단 텍스트 -->
  <text x="${PAD}" y="${H - 18}"
    font-family="${KR_FONT}" font-size="11" fill="#94A3B8">THE H 한남 현장 DABs 회의 자료</text>
  <text x="${W - PAD}" y="${H - 14}"
    font-family="${KR_FONT}" font-size="22" font-weight="700" fill="#0F172A" text-anchor="end">
    ${escXml(dateStr)}
  </text>

  <!-- 하단 컬러 바 -->
  <rect x="0" y="${H - 10}" width="${W}" height="10" fill="url(#gBot)"/>

</svg>`
}

// ── 메인 함수 ─────────────────────────────────────────────
export async function generateCoverPdf(
  rows: CoverRow[],
  dateStr: string,
): Promise<Uint8Array> {
  const totalEquip = totalEquipment(rows)
  const svg        = buildSvg(rows, dateStr, totalEquip)
  const pngBuf = await sharp(Buffer.from(svg)).png({ quality: 100 }).toBuffer()

  // A4 Landscape: 841.89 × 595.28 pt (가로 × 세로)
  const coverDoc = await PDFDocument.create()
  const page     = coverDoc.addPage([841.89, 595.28])
  const img      = await coverDoc.embedPng(pngBuf)

  page.drawImage(img, { x: 0, y: 0, width: 841.89, height: 595.28 })

  return coverDoc.save()
}
