// ============================================================
// app/api/weather/route.ts
// 기상청 API허브 초단기실황 프록시 (apihub.kma.go.kr)
// 환경변수 KMA_API_KEY 미설정 시 mock 데이터 반환
// ============================================================
import { NextResponse } from 'next/server'

// 기상청 격자 좌표 (기본값: 서울 중구)
const DEFAULT_NX = 60
const DEFAULT_NY = 127

// 풍속 경보 기준치 (m/s) — 건설현장 고소작업 중단 기준
export const WIND_WARNING_MS  = 10 // 적색 경고
export const WIND_CAUTION_MS  = 7  // 황색 주의

/**
 * KST(UTC+9) 기준으로 base_date / base_time 을 계산합니다.
 * Vercel 서버는 UTC 환경이므로 반드시 +9h 보정이 필요합니다.
 */
function getKSTBaseDateTime(): { baseDate: string; baseTime: string } {
  // UTC → KST : +9시간
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)

  const year    = kst.getUTCFullYear()
  const month   = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const day     = String(kst.getUTCDate()).padStart(2, '0')
  const hours   = kst.getUTCHours()
  const minutes = kst.getUTCMinutes()

  // 매 시 40분 이후에 해당 시간 데이터가 갱신됨 → 그 전엔 전 시간 참조
  const baseHour = minutes < 40 ? Math.max(0, hours - 1) : hours

  return {
    baseDate: `${year}${month}${day}`,
    baseTime: String(baseHour).padStart(2, '0') + '00',
  }
}

function skyLabel(sky: number | null): string {
  if (sky === 1) return '맑음'
  if (sky === 3) return '구름많음'
  if (sky === 4) return '흐림'
  return '알 수 없음'
}

function ptyLabel(pty: number | null): string {
  if (pty === 1) return '비'
  if (pty === 2) return '비/눈'
  if (pty === 3) return '눈'
  if (pty === 4) return '소나기'
  return ''
}

export async function GET() {
  const apiKey = process.env.KMA_API_KEY

  if (!apiKey) {
    // API 키 미설정 → mock 데이터
    return NextResponse.json({
      sky: 1, pty: 0, wsd: 3.5, tmp: 24,
      skyLabel: '맑음', ptyLabel: '', windWarning: false, windCaution: false,
      isMock: true,
    })
  }

  const nx = DEFAULT_NX
  const ny = DEFAULT_NY
  const { baseDate, baseTime } = getKSTBaseDateTime()

  try {
    // 기상청 API허브 — 초단기실황 (getUltraSrtNcst)
    const url = new URL(
      'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst'
    )
    url.searchParams.set('authKey',    apiKey)
    url.searchParams.set('pageNo',     '1')
    url.searchParams.set('numOfRows',  '10')
    url.searchParams.set('dataType',   'JSON')
    url.searchParams.set('base_date',  baseDate)
    url.searchParams.set('base_time',  baseTime)
    url.searchParams.set('nx',         String(nx))
    url.searchParams.set('ny',         String(ny))

    const res  = await fetch(url.toString(), { next: { revalidate: 300 } })
    const text = await res.text()

    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      console.error('[weather] JSON 파싱 실패:', text.slice(0, 200))
      throw new Error('JSON parse error')
    }

    // API 오류 코드 확인
    const resultCode: string = (data as { response?: { header?: { resultCode?: string; resultMsg?: string } } })
      ?.response?.header?.resultCode ?? ''
    if (resultCode && resultCode !== '00') {
      const resultMsg = (data as { response?: { header?: { resultMsg?: string } } })
        ?.response?.header?.resultMsg ?? ''
      console.error(`[weather] KMA API 오류 ${resultCode}: ${resultMsg}, baseDate=${baseDate}, baseTime=${baseTime}`)
      throw new Error(`KMA error ${resultCode}`)
    }

    const items: { category: string; obsrValue: string }[] =
      (data as { response?: { body?: { items?: { item?: unknown[] } } } })
      ?.response?.body?.items?.item as { category: string; obsrValue: string }[] ?? []

    const getValue = (cat: string) => {
      const item = items.find(i => i.category === cat)
      return item ? parseFloat(item.obsrValue) : null
    }

    const sky = getValue('SKY')
    const pty = getValue('PTY')
    const wsd = getValue('WSD')
    const tmp = getValue('T1H')

    console.log(`[weather] OK baseDate=${baseDate} baseTime=${baseTime} tmp=${tmp} wsd=${wsd} pty=${pty}`)

    return NextResponse.json({
      sky, pty, wsd, tmp,
      skyLabel: skyLabel(sky),
      ptyLabel: ptyLabel(pty),
      windWarning: wsd !== null && wsd >= WIND_WARNING_MS,
      windCaution: wsd !== null && wsd >= WIND_CAUTION_MS && wsd < WIND_WARNING_MS,
      isMock: false,
    })
  } catch (err) {
    console.error('[weather] 오류:', err)
    return NextResponse.json({
      sky: null, pty: null, wsd: null, tmp: null,
      skyLabel: '', ptyLabel: '', windWarning: false, windCaution: false,
      isMock: true, error: String(err),
    })
  }
}
