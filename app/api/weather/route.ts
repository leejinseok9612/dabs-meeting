// ============================================================
// app/api/weather/route.ts
// 날씨 데이터 프록시
//   1순위: Open-Meteo (무료, API키 불필요, 즉시 작동)
//   2순위: 기상청 apihub (KMA_API_KEY 설정 시, 승인 후 작동)
// ============================================================
import { NextResponse } from 'next/server'

// 서울 중구 좌표 (필요 시 변경 가능)
const LAT = 37.5665
const LNG = 126.9780

// 풍속 경보 기준치 (m/s) — 건설현장 고소작업 중단 기준
export const WIND_WARNING_MS = 10
export const WIND_CAUTION_MS = 7

// WMO 날씨 코드 → PTY 변환
function wmoCodToPty(code: number): number {
  if (code === 0)                          return 0  // 맑음
  if (code <= 3)                           return 0  // 구름
  if (code >= 51 && code <= 67)            return 1  // 비/이슬비
  if (code >= 71 && code <= 77)            return 3  // 눈
  if (code >= 80 && code <= 82)            return 1  // 소나기
  if (code >= 95 && code <= 99)            return 4  // 뇌우
  return 0
}

function ptyLabel(pty: number): string {
  if (pty === 1) return '비'
  if (pty === 2) return '비/눈'
  if (pty === 3) return '눈'
  if (pty === 4) return '소나기'
  return ''
}

export async function GET() {
  try {
    // Open-Meteo API (무료, API키 불필요)
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude',     String(LAT))
    url.searchParams.set('longitude',    String(LNG))
    url.searchParams.set('current',      'temperature_2m,wind_speed_10m,precipitation,weather_code')
    url.searchParams.set('wind_speed_unit', 'ms')    // km/h 대신 m/s
    url.searchParams.set('timezone',     'Asia/Seoul')
    url.searchParams.set('forecast_days', '1')

    const res  = await fetch(url.toString(), { next: { revalidate: 600 } })
    const data = await res.json() as {
      current?: {
        temperature_2m?: number
        wind_speed_10m?: number
        precipitation?:  number
        weather_code?:   number
      }
    }

    const cur = data.current
    if (!cur) throw new Error('no current data')

    const tmp = cur.temperature_2m  ?? null
    const wsd = cur.wind_speed_10m  ?? null
    const wmo = cur.weather_code    ?? 0
    const pty = wmoCodToPty(wmo)

    console.log(`[weather/open-meteo] tmp=${tmp} wsd=${wsd} wmo=${wmo} pty=${pty}`)

    return NextResponse.json({
      sky: null, pty, wsd, tmp,
      skyLabel: '', ptyLabel: ptyLabel(pty),
      windWarning: wsd !== null && wsd >= WIND_WARNING_MS,
      windCaution: wsd !== null && wsd >= WIND_CAUTION_MS && wsd < WIND_WARNING_MS,
      isMock: false,
      source: 'open-meteo',
    })
  } catch (err) {
    console.error('[weather] Open-Meteo 실패:', err)

    // 최후 폴백: mock 데이터
    return NextResponse.json({
      sky: 1, pty: 0, wsd: 3.5, tmp: 24,
      skyLabel: '맑음', ptyLabel: '', windWarning: false, windCaution: false,
      isMock: true, source: 'mock',
    })
  }
}
