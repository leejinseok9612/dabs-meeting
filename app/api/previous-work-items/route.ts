// ============================================================
// app/api/previous-work-items/route.ts
// 업체의 이전 회의 작업항목 불러오기
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const teamId          = req.nextUrl.searchParams.get('teamId')
  const currentMeetingId = req.nextUrl.searchParams.get('currentMeetingId') ?? ''

  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
  }

  // 현재 미팅을 제외하고 가장 최근에 작업항목을 등록한 미팅 ID 찾기
  const { data: latestItem } = await adminSupabase
    .from('work_items')
    .select('meeting_id, meetings(date, title)')
    .eq('team_id', teamId)
    .neq('meeting_id', currentMeetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestItem) {
    return NextResponse.json({ items: [], meetingDate: null, meetingTitle: null })
  }

  const prevMeetingId = latestItem.meeting_id
  const meetings = latestItem.meetings as { date?: string; title?: string } | null

  // 해당 미팅의 이 업체 작업항목 전체 조회
  const { data: items, error } = await adminSupabase
    .from('work_items')
    .select('id, work_type, work_name, location, worker_count, description, risk_factors, improvement_measures')
    .eq('team_id', teamId)
    .eq('meeting_id', prevMeetingId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    items:        items ?? [],
    meetingDate:  meetings?.date  ?? null,
    meetingTitle: meetings?.title ?? null,
  })
}
