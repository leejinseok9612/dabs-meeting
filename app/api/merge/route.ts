// ============================================================
// app/api/merge/route.ts
// PDF 병합 + 표지 자동 생성 (cover → 본문 순)
// 인증 체크는 middleware.ts 에서 처리 (matcher: ['/api/merge'])
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument }               from 'pdf-lib'
import { adminSupabase }             from '@/lib/supabase/admin'
import { generateCoverPdf, CoverRow } from '@/lib/pdf/generateCover'

// 고정 병합 순서
const COMPANY_ORDER = ['천호엔지니어링', '참마루건설', '지디건설']

export async function POST(req: NextRequest) {
  const { meetingId } = await req.json() as { meetingId: string }
  if (!meetingId) {
    return NextResponse.json({ error: 'meetingId is required' }, { status: 400 })
  }

  // ── 1. 회의 정보 조회 (날짜 표시용) ─────────────────────
  const { data: meeting } = await adminSupabase
    .from('meetings')
    .select('date')
    .eq('id', meetingId)
    .single()

  const dateStr = meeting
    ? (() => {
        const d = new Date(meeting.date)
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
      })()
    : ''

  // ── 2. 제출 목록 조회 ────────────────────────────────────
  const { data: submissions, error: subError } = await adminSupabase
    .from('submissions')
    .select('id, file_path, file_name, work_process, personnel_count, personnel_detail, equipment, teams(name)')
    .eq('meeting_id', meetingId)
    .eq('status', 'submitted')

  if (subError || !submissions || submissions.length === 0) {
    return NextResponse.json(
      { error: subError?.message ?? '제출된 자료가 없습니다.' },
      { status: 400 }
    )
  }

  // 고정 순서로 정렬
  submissions.sort((a, b) => {
    const aName = (a.teams as { name: string }[] | null)?.[0]?.name ?? ''
    const bName = (b.teams as { name: string }[] | null)?.[0]?.name ?? ''
    return (COMPANY_ORDER.indexOf(aName) ?? 99) - (COMPANY_ORDER.indexOf(bName) ?? 99)
  })

  // ── 3. 표지 생성 ─────────────────────────────────────────
  const coverRows: CoverRow[] = submissions.map(s => ({
    teamName:        (s.teams as { name: string }[] | null)?.[0]?.name ?? '—',
    workProcess:     s.work_process    ?? '',
    personnelCount:  s.personnel_count,
    personnelDetail: (s.personnel_detail as CoverRow['personnelDetail']) ?? null,
    equipment:       s.equipment       ?? '',
  }))

  const coverPdfBytes = await generateCoverPdf(coverRows, dateStr)

  // ── 4. 본문 PDF들 다운로드 ───────────────────────────────
  const bodyBuffers: Uint8Array[] = []
  for (const sub of submissions) {
    if (!sub.file_path) continue
    const { data: fileData, error: dlError } = await adminSupabase
      .storage.from('documents').download(sub.file_path)
    if (dlError || !fileData) {
      return NextResponse.json({ error: `파일 다운로드 실패: ${sub.file_name}` }, { status: 500 })
    }
    bodyBuffers.push(new Uint8Array(await fileData.arrayBuffer()))
  }

  // ── 5. 표지 + 본문 병합 ──────────────────────────────────
  const finalDoc  = await PDFDocument.create()

  // 표지 페이지 복사
  const coverDoc  = await PDFDocument.load(coverPdfBytes)
  const [coverPage] = await finalDoc.copyPages(coverDoc, [0])
  finalDoc.addPage(coverPage)

  // 본문 페이지들 복사
  for (const buf of bodyBuffers) {
    const doc    = await PDFDocument.load(buf)
    const pages  = await finalDoc.copyPages(doc, doc.getPageIndices())
    pages.forEach(p => finalDoc.addPage(p))
  }

  const mergedBytes = await finalDoc.save()

  // ── 6. Storage 저장 ──────────────────────────────────────
  const timestamp   = Date.now()
  const storagePath = `${meetingId}/final_${timestamp}.pdf`

  const { error: uploadError } = await adminSupabase
    .storage.from('merged')
    .upload(storagePath, mergedBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: '병합 파일 저장 실패' }, { status: 500 })
  }

  await adminSupabase.from('merged_pdfs').insert({
    meeting_id: meetingId,
    file_path:  storagePath,
  })

  const { data: signedUrlData } = await adminSupabase
    .storage.from('merged').createSignedUrl(storagePath, 3600)

  return NextResponse.json({
    success:     true,
    downloadUrl: signedUrlData?.signedUrl,
    filePath:    storagePath,
  })
}
