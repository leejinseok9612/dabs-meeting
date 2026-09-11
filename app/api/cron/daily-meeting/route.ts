// ============================================================
// app/api/cron/daily-meeting/route.ts
// Vercel Cron Job — 평일+토요일 매일 오전 8시(KST) 자동 회의 생성
// 금요일은 당일(금) + 익일(토) 2개 미리 생성
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

// ── 날짜 문자열로 회의 + 슬롯 생성 ────────────────────────────
async function createMeetingForDate(dateStr: string): Promise<{ success: boolean; message: string; meetingId?: string }> {

  // 이미 존재하면 스킵
  const { data: existing } = await adminSupabase
    .from('meetings')
    .select('id')
    .eq('date', dateStr)
    .maybeSingle()

  if (existing) {
    return { success: false, message: `회의 이미 존재: ${dateStr}` }
  }

  // 회의 생성
  const title = `DABs 회의 ${dateStr}`
  const { data: meeting, error: meetingError } = await adminSupabase
    .from('meetings')
    .insert({ title, date: dateStr, status: 'open' })
    .select()
    .single()

  if (meetingError || !meeting) {
    console.error(`[cron] 회의 생성 실패 (${dateStr}):`, meetingError)
    return { success: false, message: `회의 생성 실패: ${dateStr}` }
  }

  // 팀 목록 조회 → submission 슬롯 자동 생성
  const { data: teams } = await adminSupabase
    .from('teams')
    .select('id, name')
    .order('name')

  if (teams && teams.length > 0) {
    // 고정 순서: 천호엔지니어링 → 참마루건설 → 지디건설
    const ORDER = ['천호엔지니어링', '참마루건설', '지디건설']
    const sorted = [...teams].sort((a, b) => {
      const ai = ORDER.indexOf(a.name)
      const bi = ORDER.indexOf(b.name)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

    const { error: slotError } = await adminSupabase
      .from('submissions')
      .insert(
        sorted.map((t, idx) => ({
          meeting_id:  meeting.id,
          team_id:     t.id,
          order_index: idx,
          status:      'pending',
        }))
      )

    if (slotError) {
      console.error(`[cron] 슬롯 생성 실패 (${dateStr}):`, slotError)
    }
  }

  console.log(`[cron] ✅ 회의 생성 완료: ${title} (${meeting.id})`)
  return { success: true, message: `회의 생성 완료: ${dateStr}`, meetingId: meeting.id }
}

// ── KST 기준 YYYY-MM-DD 반환 ──────────────────────────────────
function kstDateStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(d).replace(/\. /g, '-').replace('.', '')
}

// ── Cron 핸들러 ───────────────────────────────────────────────
export async function GET(req: NextRequest) {

  // 1. Cron 비밀키 검증
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. 오늘 날짜 (KST 기준) 및 요일
  const today      = kstDateStr(0)
  const dayOfWeek  = new Date(today).getDay() // 0=일, 1=월, …, 5=금, 6=토

  // 3. 일요일 제외
  if (dayOfWeek === 0) {
    return NextResponse.json({ message: '일요일이라 회의를 생성하지 않습니다.', date: today })
  }

  const results: object[] = []

  // 4. 오늘 회의 생성
  const todayResult = await createMeetingForDate(today)
  results.push({ date: today, ...todayResult })

  // 5. 금요일이면 토요일 회의도 미리 생성
  if (dayOfWeek === 5) {
    const tomorrow       = kstDateStr(1)
    const tomorrowResult = await createMeetingForDate(tomorrow)
    results.push({ date: tomorrow, ...tomorrowResult })
    console.log('[cron] 금요일: 토요일 회의 선생성 완료')
  }

  return NextResponse.json({ results })
}
