import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ── 서버사이드 in-memory rate limit ─────────────────────────
// 서버리스 재시작 시 리셋됨. 더 강한 보안이 필요하면 Redis/KV 사용
const ipAttempts = new Map<string, { count: number; resetAt: number }>()

const SERVER_MAX = 10         // IP당 최대 시도
const WINDOW_MS  = 60 * 1000  // 1분 윈도우

function checkRate(ip: string): boolean {
  const now  = Date.now()
  const prev = ipAttempts.get(ip)

  if (!prev || prev.resetAt < now) {
    ipAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (prev.count >= SERVER_MAX) return false
  prev.count++
  return true
}

// POST /api/admin-pin — 관리자 PIN 검증
export async function POST(req: NextRequest) {
  // IP 기반 서버 rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? 'unknown'

  if (!checkRate(ip)) {
    return NextResponse.json(
      { ok: false, error: '너무 많은 요청입니다. 잠시 후 다시 시도하세요.' },
      { status: 429 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const { pin } = body as { pin?: string }

  if (!pin) return NextResponse.json({ ok: false, error: '핀을 입력하세요.' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'admin_pin')
    .single()

  const correctPin = data?.value ?? '1234'

  if (String(pin) === correctPin) {
    ipAttempts.delete(ip)   // 성공 시 카운터 리셋
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: '핀 번호가 틀렸습니다.' }, { status: 401 })
}
