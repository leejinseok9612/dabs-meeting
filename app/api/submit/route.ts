// ============================================================
// app/api/submit/route.ts
// 업체 자료 제출 API — service role로 RLS 우회
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const teamId          = formData.get('team_id') as string
    const meetingId       = formData.get('meeting_id') as string
    const personnelCount  = Number(formData.get('personnel_count'))
    const personnelDetailRaw = formData.get('personnel_detail') as string | null
    const workProcess     = formData.get('work_process') as string
    const equipment       = formData.get('equipment') as string
    // 파일은 선택사항
    const file = formData.get('file') as File | null

    // personnel_detail JSON 파싱 (형식 검증)
    let personnelDetail: Record<string, number> | null = null
    if (personnelDetailRaw) {
      try {
        personnelDetail = JSON.parse(personnelDetailRaw)
      } catch {
        personnelDetail = null
      }
    }

    if (!teamId || !meetingId) {
      return NextResponse.json({ error: '필수 항목이 누락됐습니다.' }, { status: 400 })
    }

    // 1. 파일이 있을 때만 Storage 업로드
    let storagePath: string | null = null
    let signedUrl: string | null   = null

    if (file && file.size > 0) {
      const timestamp    = Date.now()
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      storagePath        = `${meetingId}/${teamId}/${timestamp}_${safeFileName}`

      const arrayBuffer = await file.arrayBuffer()
      const { error: uploadError } = await adminSupabase.storage
        .from('documents')
        .upload(storagePath, arrayBuffer, { contentType: 'application/pdf', upsert: false })

      if (uploadError) {
        return NextResponse.json({ error: `파일 업로드 실패: ${uploadError.message}` }, { status: 500 })
      }

      const { data: signed } = await adminSupabase.storage
        .from('documents')
        .createSignedUrl(storagePath, 3600)
      signedUrl = signed?.signedUrl ?? null
    }

    // 2. submissions upsert (service role → RLS 우회)
    const upsertData: Record<string, unknown> = {
      meeting_id:       meetingId,
      team_id:          teamId,
      personnel_count:  personnelCount,
      personnel_detail: personnelDetail,
      work_process:     workProcess,
      equipment:        equipment,
      status:           'submitted',
      submitted_at:     new Date().toISOString(),
    }
    if (storagePath && file) {
      upsertData.file_path = storagePath
      upsertData.file_name = file.name
      upsertData.file_size = file.size
    }

    const { error: dbError } = await adminSupabase
      .from('submissions')
      .upsert(upsertData, { onConflict: 'meeting_id,team_id' })

    if (dbError) {
      return NextResponse.json({ error: `데이터 저장 실패: ${dbError.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, signedUrl: signedUrl ?? '' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
