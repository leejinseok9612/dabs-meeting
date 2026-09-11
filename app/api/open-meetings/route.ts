// ============================================================
// app/api/open-meetings/route.ts
// 현재 열린 회의 목록 조회 (협력업체 회의 선택 화면용)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get('teamId')

  // 열린 회의 전체 조회 (날짜 오름차순)
  const { data: meetings } = await adminSupabase
    .from('meetings')
    .select('id, title, date, status')
    .eq('status', 'open')
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
