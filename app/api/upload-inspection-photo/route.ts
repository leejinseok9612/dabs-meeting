// ============================================================
// app/api/upload-inspection-photo/route.ts
// 부적합 사진 파일 → Supabase Storage 업로드 후 URL 반환
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const formData  = await req.formData()
  const file      = formData.get('file')      as File   | null
  const meetingId = formData.get('meetingId') as string | null

  if (!file || !meetingId) {
    return NextResponse.json({ error: '파일과 meetingId가 필요합니다' }, { status: 400 })
  }

  // 이미지 타입 검사
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: '이미지 파일만 업로드할 수 있습니다' }, { status: 400 })
  }

  const ext   = file.name.split('.').pop() ?? 'jpg'
  const path  = `${meetingId}/${Date.now()}.${ext}`
  const bytes = await file.arrayBuffer()

  const { error: uploadError } = await adminSupabase.storage
    .from('inspection-photos')
    .upload(path, Buffer.from(bytes), {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = adminSupabase.storage
    .from('inspection-photos')
    .getPublicUrl(path)

  return NextResponse.json({ url: publicUrl })
}
