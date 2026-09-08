// ============================================================
// app/api/merge-range/route.ts
// 기간별 PDF 일괄 병합 — 중간 저장 없이 직접 생성
//
// 흐름:
//   1. 날짜 범위 내 회의 조회
//   2. 각 회의의 제출 완료 PDF 조회
//   3. 회의별 표지(generateCoverPdf) 생성
//   4. 표지 + 본문 순으로 합쳐서 하나의 PDF 반환
//   → merged_pdfs 테이블 사전 저장 불필요
// ============================================================
import { NextRequest, NextResponse }         from 'next/server'
import { PDFDocument }                        from 'pdf-lib'
import { adminSupabase }                      from '@/lib/supabase/admin'
import { generateCoverPdf, CoverRow }         from '@/lib/pdf/generateCover'

const COMPANY_ORDER = ['천호엔지니어링', '참마루건설', '지디건설']

function makeDateStr(dateIso: string): string {
  const d = new Date(dateIso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

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

    // ── 1. 기간 내 회의 목록 (날짜 오름차순) ───────────────
    const { data: meetings, error: mtgErr } = await adminSupabase
      .from('meetings')
      .select('id, date, title')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (mtgErr) return NextResponse.json({ error: mtgErr.message }, { status: 500 })
    if (!meetings || meetings.length === 0) {
      return NextResponse.json({ error: '해당 기간에 등록된 회의가 없습니다.' }, { status: 400 })
    }

    const finalDoc    = await PDFDocument.create()
    let   mergedCount = 0

    for (const meeting of meetings) {
      // ── 2. 회의별 제출 완료 목록 조회 ─────────────────────
      const { data: submissions } = await adminSupabase
        .from('submissions')
        .select('id, file_path, file_name, work_process, personnel_count, personnel_detail, equipment, teams(name)')
        .eq('meeting_id', meeting.id)
        .eq('status', 'submitted')

      if (!submissions || submissions.length === 0) continue  // 제출 없는 회의 스킵

      // ── 3. 고정 순서 정렬 ──────────────────────────────────
      submissions.sort((a, b) => {
        const aName = (a.teams as { name: string }[] | null)?.[0]?.name ?? ''
        const bName = (b.teams as { name: string }[] | null)?.[0]?.name ?? ''
        return (COMPANY_ORDER.indexOf(aName) === -1 ? 99 : COMPANY_ORDER.indexOf(aName))
             - (COMPANY_ORDER.indexOf(bName) === -1 ? 99 : COMPANY_ORDER.indexOf(bName))
      })

      // ── 4. 표지 생성 ───────────────────────────────────────
      const coverRows: CoverRow[] = submissions.map(s => ({
        teamName:        (s.teams as { name: string }[] | null)?.[0]?.name ?? '—',
        workProcess:     s.work_process    ?? '',
        personnelCount:  s.personnel_count ?? null,
        personnelDetail: (s.personnel_detail as CoverRow['personnelDetail']) ?? null,
        equipment:       s.equipment       ?? '',
      }))

      try {
        const coverBytes = await generateCoverPdf(coverRows, makeDateStr(meeting.date))
        const coverDoc   = await PDFDocument.load(coverBytes)
        const [coverPage] = await finalDoc.copyPages(coverDoc, [0])
        finalDoc.addPage(coverPage)
      } catch {
        // 표지 생성 실패 시 본문만 포함
      }

      // ── 5. 본문 PDF 병합 ───────────────────────────────────
      for (const sub of submissions) {
        if (!sub.file_path) continue
        try {
          const { data: fileData, error: dlErr } = await adminSupabase
            .storage.from('documents').download(sub.file_path)
          if (dlErr || !fileData) continue

          const buf   = new Uint8Array(await fileData.arrayBuffer())
          const doc   = await PDFDocument.load(buf)
          const pages = await finalDoc.copyPages(doc, doc.getPageIndices())
          pages.forEach(p => finalDoc.addPage(p))
        } catch {
          // 개별 파일 실패 시 건너뜀
          continue
        }
      }

      mergedCount++
    }

    if (finalDoc.getPageCount() === 0) {
      return NextResponse.json(
        { error: '해당 기간에 제출된 자료가 없습니다. 업체 제출 여부를 확인해주세요.' },
        { status: 400 }
      )
    }

    // ── 6. PDF 반환 ────────────────────────────────────────
    const bytes    = await finalDoc.save()
    const filename = `DABs_${startDate}_${endDate}.pdf`

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Merged-Count':      String(mergedCount),
        'X-Date-Range':        `${startDate} ~ ${endDate}`,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
