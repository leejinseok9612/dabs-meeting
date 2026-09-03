// ============================================================
// app/api/meeting-info/route.ts
// 회의 기본 정보 조회 (회의 모드용)
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const meetingId = req.nextUrl.searchParams.get('meetingId')
  if (!meetingId) {
    return NextResponse.json({ error: 'meetingId required' }, { status: 400 })
  }

  const { data: meeting, error } = await adminSupabase
    .from('meetings')
    .select('id, title, date, status, map_file_url, map_file_name')
    .eq('id', meetingId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!meeting) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ meeting })
}
