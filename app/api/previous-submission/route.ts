// ============================================================
// app/api/previous-submission/route.ts
// 업체 이전 제출 내용 불러오기 (가장 최근 submitted 기록)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get('teamId')

  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
  }

  // 가장 최근 제출된 submission (현재 날짜 무관, submitted_at 내림차순)
  const { data, error } = await adminSupabase
    .from('submissions')
    .select(`
      personnel_count,
      personnel_detail,
      work_process,
      equipment,
      submitted_at,
      meetings ( date, title )
    `)
    .eq('team_id', teamId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ previous: null })
  }

  return NextResponse.json({ previous: data })
}
