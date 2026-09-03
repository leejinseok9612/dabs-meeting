// ============================================================
// app/api/weather/debug/route.ts
// 날씨 API 상세 디버그 (관리자용)
// ============================================================
import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.KMA_API_KEY
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const year    = kst.getUTCFullYear()
  const month   = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const day     = String(kst.getUTCDate()).padStart(2, '0')
  const hours   = kst.getUTCHours()
  const minutes = kst.getUTCMinutes()
  const baseHour = minutes < 40 ? Math.max(0, hours - 1) : hours
  const baseDate = `${year}${month}${day}`
  const baseTime = String(baseHour).padStart(2, '0') + '00'

  const info: Record<string, unknown> = {
    apiKeySet:  !!apiKey,
    apiKeyLen:  apiKey?.length ?? 0,
    apiKeyHead: apiKey ? apiKey.slice(0, 8) + '...' : null,
    kstNow:     kst.toISOString(),
    baseDate,
    baseTime,
  }

  if (!apiKey) {
    return NextResponse.json({ ...info, error: 'KMA_API_KEY not set' })
  }

  const url = new URL(
    'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst'
  )
  url.searchParams.set('authKey',   apiKey)
  url.searchParams.set('pageNo',    '1')
  url.searchParams.set('numOfRows', '10')
  url.searchParams.set('dataType',  'JSON')
  url.searchParams.set('base_date', baseDate)
  url.searchParams.set('base_time', baseTime)
  url.searchParams.set('nx',        '60')
  url.searchParams.set('ny',        '127')

  try {
    const res  = await fetch(url.toString(), { cache: 'no-store' })
    const text = await res.text()
    const statusCode = res.status

    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { /* keep null */ }

    return NextResponse.json({
      ...info,
      httpStatus: statusCode,
      rawSnippet: text.slice(0, 500),
      parsed,
    })
  } catch (err) {
    return NextResponse.json({
      ...info,
      fetchError: String(err),
    })
  }
}
