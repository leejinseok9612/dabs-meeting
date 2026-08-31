import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/work-items?meetingId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const meetingId = searchParams.get('meetingId')
  if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('work_items')
    .select('*, teams(id, name)')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true })

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
