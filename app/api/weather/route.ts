// ============================================================
// app/api/weather/route.ts
// 날씨 데이터 프록시
//   1순위: 기상청 apihub — 초단기실황 (KMA_API_KEY 설정 시)
//   2순위: Open-Meteo (무료, API키 불필요, 폴백)
// ============================================================
import { NextResponse } from 'next/server'

// 서울 격자 좌표
const KMA_NX = '60'
const KMA_NY = '127'

// Open-Meteo 좌표
const LAT = 37.5665
const LNG = 126.9780

// 풍속 경보 기준치 (m/s) — 건설현장 고소작업 중단 기준
export const WIND_WARNING_MS = 10
export const WIND_CAUTION_MS = 7

// ── 기상청 base_date / base_time 계산 ─────────────────────
function kmaBaseParams() {
  const kst     = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const year    = kst.getUTCFullYear()
  const month   = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const day     = String(kst.getUTCDate()).padStart(2, '0')
  const hours   = kst.getUTCHours()
  const minutes = kst.getUTCMinutes()
  // 초단기실황: 매 정시 관측, 40분 이전이면 이전 시각 데이터 사용
  const baseHour = minutes < 40 ? Math.max(0, hours - 1) : hours
  return {
    base_date: `${year}${month}${day}`,
    base_time: String(baseHour).padStart(2, '0') + '00',
  }
}

// ── PTY 레이블 ────────────────────────────────────────────
function ptyLabel(pty: number): string {
  if (pty === 1) return '비'
  if (pty === 2) return '비/눈'
  if (pty === 3) return '눈'
  if (pty === 4) return '소나기'
  return ''
}

// ── SKY 레이블 ────────────────────────────────────────────
function skyLabel(sky: number | null): string {
  if (sky === 1) return '맑음'
  if (sky === 3) return '구름많음'
  if (sky === 4) return '흐림'
  return ''
}

// ── WMO → PTY 변환 (Open-Meteo 폴백용) ──────────────────
function wmoCodToPty(code: number): number {
  if (code === 0)                return 0
  if (code <= 3)                 return 0
  if (code >= 51 && code <= 67)  return 1
  if (code >= 71 && code <= 77)  return 3
  if (code >= 80 && code <= 82)  return 1
  if (code >= 95 && code <= 99)  return 4
  return 0
}

export async function GET() {
  // ──────────────────────────────────────────────────────
  // 1순위: 기상청 apihub 초단기실황
  // ──────────────────────────────────────────────────────
  const apiKey = process.env.KMA_API_KEY
  if (apiKey) {
    try {
      const { base_date, base_time } = kmaBaseParams()
      const url = new URL(
        'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst'
      )
      url.searchParams.set('authKey',    apiKey)
      url.searchParams.set('pageNo',     '1')
      url.searchParams.set('numOfRows',  '10')
      url.searchParams.set('dataType',   'JSON')
      url.searchParams.set('base_date',  base_date)
      url.searchParams.set('base_time',  base_time)
      url.searchParams.set('nx',         KMA_NX)
      url.searchParams.set('ny',         KMA_NY)

      // 5초 타임아웃 — 기상청 응답 지연 시 Open-Meteo로 자동 폴백
      const res  = await fetch(url.toString(), {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      })
      const json = await res.json() as {
        response?: {
          header?: { resultCode?: string }
          body?:   { items?: { item?: { category: string; obsrValue: string }[] } }
        }
      }

      const code  = json?.response?.header?.resultCode
      const items = json?.response?.body?.items?.item ?? []

      if (code === '00' && items.length > 0) {
        const get = (cat: string) => {
          const found = items.find(i => i.category === cat)
          return found ? parseFloat(found.obsrValue) : null
        }

        const tmp = get('T1H')                       // 기온 (°C)
        const wsd = get('WSD')                       // 풍속 (m/s)
        const pty = Math.round(get('PTY') ?? 0)      // 강수형태

        return NextResponse.json({
          sky: null, pty, wsd, tmp,
          skyLabel: '', ptyLabel: ptyLabel(pty),
          windWarning: wsd !== null && wsd >= WIND_WARNING_MS,
          windCaution: wsd !== null && wsd >= WIND_CAUTION_MS && wsd < WIND_WARNING_MS,
          isMock: false,
          source: 'kma',
        })
      }

      console.warn(`[weather/kma] resultCode=${code} items=${items.length} — Open-Meteo 폴백`)
    } catch (err) {
      console.error('[weather/kma] 오류, Open-Meteo로 폴백:', err)
    }
  }

  // ──────────────────────────────────────────────────────
  // 2순위: Open-Meteo (폴백)
  // ──────────────────────────────────────────────────────
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude',        String(LAT))
    url.searchParams.set('longitude',       String(LNG))
    url.searchParams.set('current',         'temperature_2m,wind_speed_10m,precipitation,weather_code')
    url.searchParams.set('wind_speed_unit', 'ms')
    url.searchParams.set('timezone',        'Asia/Seoul')
    url.searchParams.set('forecast_days',   '1')

    const res  = await fetch(url.toString(), {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    })
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

    const tmp = cur.temperature_2m ?? null
    const wsd = cur.wind_speed_10m ?? null
    const wmo = cur.weather_code   ?? 0
    const pty = wmoCodToPty(wmo)

    return NextResponse.json({
      sky: null, pty, wsd, tmp,
      skyLabel: skyLabel(null), ptyLabel: ptyLabel(pty),
      windWarning: wsd !== null && wsd >= WIND_WARNING_MS,
      windCaution: wsd !== null && wsd >= WIND_CAUTION_MS && wsd < WIND_WARNING_MS,
      isMock: false,
      source: 'open-meteo',
    })
  } catch (err) {
    console.error('[weather] Open-Meteo 실패, mock 폴백:', err)
  }

  // ──────────────────────────────────────────────────────
  // 최후 폴백: mock
  // ──────────────────────────────────────────────────────
  return NextResponse.json({
    sky: 1, pty: 0, wsd: 3.5, tmp: 24,
    skyLabel: '맑음', ptyLabel: '', windWarning: false, windCaution: false,
    isMock: true, source: 'mock',
  })
}
