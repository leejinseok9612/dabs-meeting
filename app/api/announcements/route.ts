import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/announcements?activeOnly=true
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const activeOnly = searchParams.get('activeOnly') === 'true'

  const supabase = await createServerSupabase()
  let query = supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })

  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/announcements
export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('announcements')
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/announcements
export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('announcements')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/announcements?id=xxx
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
