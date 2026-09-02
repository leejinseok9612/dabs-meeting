// ============================================================
// app/api/submit-info/route.ts
// 업체 제출 페이지용 팀 + 오늘 회의 정보 조회
// service role 사용 → RLS 우회 (공개 접근 가능)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase/admin'

function getTodayKST(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  })
    .format(new Date())
    .replace(/\. /g, '-')
    .replace('.', '')
}

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get('teamId')
  if (!teamId) {
    return NextResponse.json({ error: 'teamId required' }, { status: 400 })
  }

  // 팀 조회
  const { data: team } = await adminSupabase
    .from('teams')
    .select('id, name, department')
    .eq('id', teamId)
    .maybeSingle()

  if (!team) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  // 오늘 열린 회의 조회 (KST 기준)
  const today = getTodayKST()
  const { data: meeting } = await adminSupabase
    .from('meetings')
    .select('id, title, date, status, map_file_url, map_file_name')
    .eq('date', today)
    .eq('status', 'open')
    .maybeSingle()

  // 지적도가 없으면 가장 최근 회의에서 자동으로 가져옴
  if (meeting && !meeting.map_file_url) {
    const { data: latest } = await adminSupabase
      .from('meetings')
      .select('map_file_url, map_file_name')
      .neq('id', meeting.id)
      .not('map_file_url', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest?.map_file_url) {
      meeting.map_file_url  = latest.map_file_url
      meeting.map_file_name = latest.map_file_name ?? null

      // 현재 회의에도 저장해 다음 로드 시 바로 표시
      await adminSupabase
        .from('meetings')
        .update({ map_file_url: latest.map_file_url, map_file_name: latest.map_file_name })
        .eq('id', meeting.id)
    }
  }

  return NextResponse.json({ team, meeting: meeting ?? null })
}
