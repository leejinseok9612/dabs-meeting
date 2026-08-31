import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// POST /api/admin-pin — 관리자 PIN 검증
export async function POST(req: NextRequest) {
  const { pin } = await req.json()
  if (!pin) return NextResponse.json({ ok: false, error: '핀을 입력하세요.' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'admin_pin')
    .single()

  const correctPin = data?.value ?? '1234'

  if (String(pin) === correctPin) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: '핀 번호가 틀렸습니다.' }, { status: 401 })
}
