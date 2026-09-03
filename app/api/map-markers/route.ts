import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/map-markers?meetingId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const meetingId = searchParams.get('meetingId')
  if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('map_markers')
    .select('*, teams(id, name)')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/map-markers
export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('map_markers')
    .insert(body)
    .select('*, teams(id, name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/map-markers — 작업명 변경 시 연결된 마커 라벨 동기화
// body: { meetingId, teamId, oldLabel, newLabel, workType }
export async function PATCH(req: NextRequest) {
  const { meetingId, teamId, oldLabel, newLabel, workType } = await req.json()
  if (!meetingId || !teamId || !oldLabel || !newLabel) {
    return NextResponse.json({ error: 'meetingId, teamId, oldLabel, newLabel required' }, { status: 400 })
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('map_markers')
    .update({ label: newLabel })
    .eq('meeting_id', meetingId)
    .eq('team_id', teamId)
    .eq('label', oldLabel)
    .eq('work_type', workType)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/map-markers?id=xxx  또는 ?meetingId=&teamId=&label=&workType= (작업항목 삭제 시 마커 일괄 삭제)
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id        = searchParams.get('id')
  const meetingId = searchParams.get('meetingId')
  const teamId    = searchParams.get('teamId')
  const label     = searchParams.get('label')
  const workType  = searchParams.get('workType')

  const supabase = await createServerSupabase()

  if (id) {
    // 단건 삭제 (마커 직접 삭제)
    const { error } = await supabase.from('map_markers').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (meetingId && teamId && label && workType) {
    // 작업항목 연동 삭제 (label + team + workType 매칭)
    const { error } = await supabase
      .from('map_markers')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('team_id', teamId)
      .eq('label', label)
      .eq('work_type', workType)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'id 또는 meetingId+teamId+label+workType 필요' }, { status: 400 })
}
