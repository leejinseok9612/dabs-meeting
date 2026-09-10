import { adminSupabase } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/admin/users — 전체 계정 목록
export async function GET() {
  const { data, error } = await adminSupabase.auth.admin.listUsers()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const users = data.users.map(u => ({
    id:           u.id,
    email:        u.email ?? '',
    created_at:   u.created_at,
    last_sign_in: u.last_sign_in_at ?? null,
    confirmed:    !!u.email_confirmed_at,
  }))

  return NextResponse.json(users)
}

// DELETE /api/admin/users?id=xxx — 계정 삭제
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await adminSupabase.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
