// ============================================================
// app/api/cron/daily-meeting/route.ts
// Vercel Cron Job — 평일 매일 오전 8시(KST) 자동 회의 생성
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {

  // ── 1. Cron 비밀키 검증 (무단 호출 방지) ──────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. 오늘 날짜 (KST 기준) ───────────────────────────────
  const today = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(new Date()).replace(/\. /g, '-').replace('.', '') // YYYY-MM-DD

  // ── 3. 오늘이 평일인지 확인 (토·일 제외) ─────────────────
  const dayOfWeek = new Date(today).getDay() // 0=일, 6=토
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ message: '주말이라 회의를 생성하지 않습니다.', date: today })
  }

  // ── 4. 오늘 회의가 이미 있는지 확인 ──────────────────────
  const { data: existing } = await adminSupabase
    .from('meetings')
    .select('id')
    .eq('date', today)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ message: '오늘 회의가 이미 존재합니다.', date: today })
  }

  // ── 5. 회의 생성 ─────────────────────────────────────────
  const title = `DABs 회의 ${today}`

  const { data: meeting, error: meetingError } = await adminSupabase
    .from('meetings')
    .insert({ title, date: today, status: 'open' })
    .select()
    .single()

  if (meetingError || !meeting) {
    console.error('[cron] 회의 생성 실패:', meetingError)
    return NextResponse.json({ error: '회의 생성 실패' }, { status: 500 })
  }

  // ── 6. 팀 목록 조회 → submission 슬롯 자동 생성 ──────────
  const { data: teams } = await adminSupabase
    .from('teams')
    .select('id, name')
    .order('name')

  if (teams && teams.length > 0) {

    // 고정 순서: 천호엔지니어링 → 참마루건설 → 지디건설
    const ORDER = ['천호엔지니어링', '참마루건설', '지디건설']
    const sorted = [...teams].sort((a, b) => {
      const ai = ORDER.indexOf(a.name)
      const bi = ORDER.indexOf(b.name)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

    const { error: slotError } = await adminSupabase
      .from('submissions')
      .insert(
        sorted.map((t, idx) => ({
          meeting_id:  meeting.id,
          team_id:     t.id,
          order_index: idx,
          status:      'pending',
        }))
      )

    if (slotError) {
      console.error('[cron] 슬롯 생성 실패:', slotError)
    }
  }

  console.log(`[cron] ✅ 회의 생성 완료: ${title} (${meeting.id})`)

  return NextResponse.json({
    success:   true,
    meetingId: meeting.id,
    title,
    date:      today,
    slots:     teams?.length ?? 0,
  })
}
