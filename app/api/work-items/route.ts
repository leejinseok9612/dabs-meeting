import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/work-items?meetingId=xxx[&submittedOnly=true]
// submittedOnly=true: submissions.submitted_at IS NOT NULL 인 팀의 작업항목만 반환
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const meetingId     = searchParams.get('meetingId')
  const submittedOnly = searchParams.get('submittedOnly') === 'true'
  if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 })

  const supabase = await createServerSupabase()

  // submittedOnly: 실제 제출(submitted_at NOT NULL)한 팀 ID만 추려서 필터
  let allowedTeamIds: string[] | null = null
  if (submittedOnly) {
    const { data: subs } = await supabase
      .from('submissions')
      .select('team_id')
      .eq('meeting_id', meetingId)
      .not('submitted_at', 'is', null)
    allowedTeamIds = (subs ?? []).map((s: { team_id: string }) => s.team_id)
  }

  let query = supabase
    .from('work_items')
    .select('*, teams(id, name)')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true })

  if (allowedTeamIds !== null) {
    query = query.in('team_id', allowedTeamIds.length > 0 ? allowedTeamIds : ['__none__'])
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/work-items
export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('work_items')
    .insert(body)
    .select('*, teams(id, name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/work-items
export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('work_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, teams(id, name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/work-items?id=xxx
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('work_items').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
