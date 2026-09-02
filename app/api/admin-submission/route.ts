import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// PATCH /api/admin-submission — 관리자가 제출 상태/메모 업데이트
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { submissionId, reviewedStatus, adminNotes } = body as {
    submissionId?: string
    reviewedStatus?: 'approved' | 'revision_requested' | null
    adminNotes?: string
  }

  if (!submissionId) {
    return NextResponse.json({ error: 'submissionId가 필요합니다.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  const { error } = await supabase
    .from('submissions')
    .update({
      reviewed_status: reviewedStatus ?? null,
      admin_notes:     adminNotes ?? null,
      reviewed_at:     reviewedStatus ? new Date().toISOString() : null,
    })
    .eq('id', submissionId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
