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
    .select('id, title, date, status')
    .eq('date', today)
    .eq('status', 'open')
    .maybeSingle()

  return NextResponse.json({ team, meeting: meeting ?? null })
}
