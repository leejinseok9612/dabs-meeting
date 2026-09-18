// ============================================================
// app/api/open-meetings/route.ts
// 현재 열린 회의 목록 조회 (협력업체 회의 선택 화면용)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

// KST 기준 날짜 계산 헬퍼
function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)   // UTC → KST
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get('teamId')

  // 이번 주 범위 계산 (KST 기준)
  // 시작: 이번 주 월요일 / 끝: 오늘 (금요일이면 토요일까지 포함)
  const todayKST  = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const dayOfWeek = todayKST.getUTCDay()  // 0=일, 1=월 … 5=금, 6=토

  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1   // 일요일이면 6일 전이 월요일
  const weekStart = kstDateStr(-daysFromMonday)                  // 이번 주 월요일
  const weekEnd   = dayOfWeek === 5 ? kstDateStr(1) : kstDateStr(0)  // 금요일이면 토요일까지

  // 이번 주 범위의 열린 회의 조회 (날짜 오름차순)
  const { data: meetings } = await adminSupabase
    .from('meetings')
    .select('id, title, date, status')
    .eq('status', 'open')
    .gte('date', weekStart)
    .lte('date', weekEnd)
    .order('date', { ascending: true })

  if (!meetings || meetings.length === 0) {
    return NextResponse.json([])
  }

  // 팀 제출 여부 병행 조회
  let submittedMeetingIds = new Set<string>()
  if (teamId) {
    const { data: subs } = await adminSupabase
      .from('submissions')
      .select('meeting_id, status')
      .eq('team_id', teamId)
      .in('meeting_id', meetings.map(m => m.id))

    if (subs) {
      submittedMeetingIds = new Set(
        subs.filter(s => s.status === 'submitted').map(s => s.meeting_id)
      )
    }
  }

  const result = meetings.map(m => ({
    ...m,
    submitted: submittedMeetingIds.has(m.id),
  }))

  return NextResponse.json(result)
}
