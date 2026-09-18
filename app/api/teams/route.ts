import { adminSupabase } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/teams — 전체 팀 목록
export async function GET() {
  const { data, error } = await adminSupabase
    .from('teams')
    .select('id, name, department')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/teams — 업체 추가 (관리자 PIN 인증 후 사용, RLS 우회)
export async function POST(req: NextRequest) {
  const { name, department } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('teams')
    .insert({ name: name.trim(), department: department?.trim() || null })
    .select('id, name, department')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/teams?id=xxx — 업체 삭제 (관리자 PIN 인증 후 사용, RLS 우회)
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await adminSupabase.from('teams').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
