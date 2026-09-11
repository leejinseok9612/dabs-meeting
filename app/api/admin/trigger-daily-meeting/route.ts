// ============================================================
// app/api/admin/trigger-daily-meeting/route.ts
// 관리자 수동 회의 생성 — 세션 인증 기반 (CRON_SECRET 불필요)
// middleware.ts 가 /api/admin/** 를 보호
// 금요일은 당일(금) + 익일(토) 2개 미리 생성
// ============================================================
import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase/admin'

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

// ── 날짜 문자열로 회의 + 슬롯 생성 ────────────────────────────
async function createMeetingForDate(dateStr: string): Promise<{ success: boolean; message: string; meetingId?: string; slots?: number }> {

  // 이미 존재하면 스킵
  const { data: existing } = await adminSupabase
    .from('meetings')
    .select('id, title')
    .eq('date', dateStr)
    .maybeSingle()

  if (existing) {
    return { success: false, message: `${dateStr} 회의가 이미 존재합니다.` }
  }

  // 회의 생성
  const title = `DABs 회의 ${dateStr}`
  const { data: meeting, error: meetingError } = await adminSupabase
    .from('meetings')
    .insert({ title, date: dateStr, status: 'open' })
    .select()
    .single()

  if (meetingError || !meeting) {
    return { success: false, message: `${dateStr} 회의 생성 실패` }
  }

  // 제출 슬롯 자동 생성
  const { data: teams } = await adminSupabase
    .from('teams')
    .select('id, name')
    .order('name')

  if (teams && teams.length > 0) {
    const ORDER = ['천호엔지니어링', '참마루건설', '지디건설']
    const sorted = [...teams].sort((a, b) => {
      const ai = ORDER.indexOf(a.name)
      const bi = ORDER.indexOf(b.name)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

    await adminSupabase.from('submissions').insert(
      sorted.map((t, idx) => ({
        meeting_id:  meeting.id,
        team_id:     t.id,
        order_index: idx,
        status:      'pending',
      }))
    )
  }

  return { success: true, message: `${dateStr} 회의 생성 완료`, meetingId: meeting.id, slots: teams?.length ?? 0 }
}

// ── 핸들러 ────────────────────────────────────────────────────
export async function POST() {
  const today     = kstDateStr(0)
  const dayOfWeek = new Date(today).getDay() // 0=일, 5=금, 6=토

  // 일요일 제외
  if (dayOfWeek === 0) {
    return NextResponse.json({ message: '일요일이라 회의를 생성하지 않습니다.', date: today })
  }

  const results: object[] = []

  // 오늘 회의 생성
  const todayResult = await createMeetingForDate(today)
  results.push({ date: today, ...todayResult })

  // 금요일이면 토요일 회의도 미리 생성
  if (dayOfWeek === 5) {
    const tomorrow       = kstDateStr(1)
    const tomorrowResult = await createMeetingForDate(tomorrow)
    results.push({ date: tomorrow, ...tomorrowResult })
  }

  return NextResponse.json({ results })
}
