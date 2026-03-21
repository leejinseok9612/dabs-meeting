// ============================================================
// app/api/admin/trigger-daily-meeting/route.ts
// 관리자 수동 회의 생성 — 세션 인증 기반 (CRON_SECRET 불필요)
// middleware.ts 가 /api/admin/** 를 보호
// ============================================================
import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase/admin'

export async function POST() {
  // ── 오늘 날짜 (KST) ────────────────────────────────────────
  const today = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(new Date()).replace(/\. /g, '-').replace('.', '')

  // ── 평일 여부 확인 ─────────────────────────────────────────
  const dayOfWeek = new Date(today).getDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ message: '주말이라 회의를 생성하지 않습니다.', date: today })
  }

  // ── 오늘 회의 중복 확인 ────────────────────────────────────
  const { data: existing } = await adminSupabase
    .from('meetings')
    .select('id, title')
    .eq('date', today)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ message: '오늘 회의가 이미 존재합니다.', date: today })
  }

  // ── 회의 생성 ─────────────────────────────────────────────
  const title = `DABs 회의 ${today}`

  const { data: meeting, error: meetingError } = await adminSupabase
    .from('meetings')
    .insert({ title, date: today, status: 'open' })
    .select()
    .single()

  if (meetingError || !meeting) {
    return NextResponse.json({ error: '회의 생성 실패' }, { status: 500 })
  }

  // ── 제출 슬롯 자동 생성 ────────────────────────────────────
  const { data: teams } = await adminSupabase
    .from('teams')
    .select('id, name')
    .order('name')

  if (teams && teams.length > 0) {
    const ORDER = ['천호엔지니어링', '참마루건설', '지디건설']
    const sorted = [...teams].sort((a, b) => {
      const ai = ORDER.indexOf(a.name)
      const bi = ORDER.indexOf(b.name)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

    await adminSupabase.from('submissions').insert(
      sorted.map((t, idx) => ({
        meeting_id:  meeting.id,
        team_id:     t.id,
        order_index: idx,
        status:      'pending',
      }))
    )
  }

  return NextResponse.json({
    success:   true,
    meetingId: meeting.id,
    title,
    date:      today,
    slots:     teams?.length ?? 0,
  })
}
