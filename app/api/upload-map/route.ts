import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// POST /api/upload-map — 지적도/공사현황도 업로드
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file      = formData.get('file') as File | null
  const meetingId = formData.get('meetingId') as string | null

  if (!file || !meetingId) {
    return NextResponse.json({ error: '파일과 meetingId가 필요합니다' }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const ext      = file.name.split('.').pop()
  const path     = `maps/${meetingId}.${ext}`
  const bytes    = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from('maps')
    .upload(path, Buffer.from(bytes), {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage.from('maps').getPublicUrl(path)

  // meetings 테이블 업데이트
  const { error: updateError } = await supabase
    .from('meetings')
    .update({ map_file_url: publicUrl, map_file_name: file.name })
    .eq('id', meetingId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ url: publicUrl, name: file.name })
}
