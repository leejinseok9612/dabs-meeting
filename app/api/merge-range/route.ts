// ============================================================
// app/api/merge-range/route.ts
// 기간별 병합 PDF 일괄 다운로드
// 각 회의의 최신 merged PDF를 합쳐서 하나의 PDF로 반환
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument }               from 'pdf-lib'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    const { startDate, endDate } = await req.json() as {
      startDate: string  // YYYY-MM-DD
      endDate:   string  // YYYY-MM-DD
    }

    if (!startDate || !endDate) {
      return NextResponse.json({ error: '시작일과 종료일을 입력해주세요.' }, { status: 400 })
    }
    if (startDate > endDate) {
      return NextResponse.json({ error: '시작일이 종료일보다 늦을 수 없습니다.' }, { status: 400 })
    }

    // ── 1. 기간 내 회의 목록 조회 (날짜 오름차순) ──────────
    const { data: meetings, error: mtgErr } = await adminSupabase
      .from('meetings')
      .select('id, date, title')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (mtgErr) {
      return NextResponse.json({ error: mtgErr.message }, { status: 500 })
    }
    if (!meetings || meetings.length === 0) {
      return NextResponse.json({ error: '해당 기간에 등록된 회의가 없습니다.' }, { status: 400 })
    }

    // ── 2. 각 회의의 최신 병합 PDF 경로 수집 ───────────────
    const targets: { date: string; title: string; filePath: string }[] = []

    for (const meeting of meetings) {
      const { data: merged } = await adminSupabase
        .from('merged_pdfs')
        .select('file_path, created_at')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (merged && merged.length > 0) {
        targets.push({
          date:     meeting.date,
          title:    meeting.title,
          filePath: merged[0].file_path,
        })
      }
    }

    if (targets.length === 0) {
      return NextResponse.json(
        { error: '해당 기간에 병합된 PDF가 없습니다. 각 회의에서 먼저 병합을 실행해주세요.' },
        { status: 400 }
      )
    }

    // ── 3. 각 PDF 다운로드 후 합치기 ───────────────────────
    const finalDoc = await PDFDocument.create()

    for (const target of targets) {
      const { data: fileData, error: dlErr } = await adminSupabase
        .storage
        .from('merged')
        .download(target.filePath)

      if (dlErr || !fileData) {
        console.warn(`[merge-range] 파일 다운로드 실패: ${target.filePath}`, dlErr?.message)
        continue  // 실패한 파일은 건너뜀
      }

      try {
        const buf  = new Uint8Array(await fileData.arrayBuffer())
        const doc  = await PDFDocument.load(buf)
        const pages = await finalDoc.copyPages(doc, doc.getPageIndices())
        pages.forEach(p => finalDoc.addPage(p))
      } catch (e) {
        console.warn(`[merge-range] PDF 파싱 실패: ${target.filePath}`, e)
        continue
      }
    }

    if (finalDoc.getPageCount() === 0) {
      return NextResponse.json({ error: 'PDF 파일을 불러올 수 없습니다.' }, { status: 500 })
    }

    // ── 4. 바이너리 응답 ────────────────────────────────────
    const bytes    = await finalDoc.save()
    const filename = `DABs_${startDate}_${endDate}.pdf`

    return new NextResponse(bytes, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Merged-Count':      String(targets.length),
        'X-Date-Range':        `${startDate} ~ ${endDate}`,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
