// ============================================================
// app/api/inspection-photos/route.ts
// 부적합 사진 CRUD
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

// ── GET: 회의별 사진 목록 ────────────────────────────────────
export async function GET(req: NextRequest) {
  const meetingId = req.nextUrl.searchParams.get('meetingId')
  if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('inspection_photos')
    .select('id, image_url, caption, sort_order, created_at')
    .eq('meeting_id', meetingId)
    .order('sort_order', { ascending: true })
    .order('created_at',  { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// ── POST: 사진 추가 ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { meeting_id, image_url, caption, sort_order } = body

  if (!meeting_id || !image_url) {
    return NextResponse.json({ error: 'meeting_id, image_url required' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('inspection_photos')
    .insert({ meeting_id, image_url, caption: caption ?? '', sort_order: sort_order ?? 0 })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ── PUT: 캡션/순서 수정 ──────────────────────────────────────
export async function PUT(req: NextRequest) {
  const id   = req.nextUrl.searchParams.get('id')
  const body = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (body.caption    !== undefined) updates.caption    = body.caption
  if (body.sort_order !== undefined) updates.sort_order = body.sort_order

  const { data, error } = await adminSupabase
    .from('inspection_photos')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ── DELETE: 사진 삭제 ────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // image_url에서 스토리지 경로 추출 후 삭제
  const { data: photo } = await adminSupabase
    .from('inspection_photos')
    .select('image_url')
    .eq('id', id)
    .single()

  if (photo?.image_url) {
    try {
      const url  = new URL(photo.image_url)
      const path = url.pathname.split('/inspection-photos/').at(1)
      if (path) await adminSupabase.storage.from('inspection-photos').remove([path])
    } catch { /* URL 파싱 실패 무시 */ }
  }

  const { error } = await adminSupabase.from('inspection_photos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
