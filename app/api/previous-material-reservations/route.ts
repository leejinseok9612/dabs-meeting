// ============================================================
// app/api/previous-material-reservations/route.ts
// 업체의 이전 회의 자재 반입 예약 내역 불러오기
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase }             from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const teamId           = req.nextUrl.searchParams.get('teamId')
  const currentMeetingId = req.nextUrl.searchParams.get('currentMeetingId') ?? ''

  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
  }

  // 현재 회의의 슬롯 ID 목록 조회 (제외 대상)
  const { data: currentSlots } = await adminSupabase
    .from('material_slots')
    .select('id')
    .eq('meeting_id', currentMeetingId)

  const currentSlotIds = (currentSlots ?? []).map(s => s.id as string)

  // 이전 회의 예약 중 가장 최근 1건 조회
  let query = adminSupabase
    .from('material_reservations')
    .select(`
      material_description,
      quantity,
      vehicle_type,
      unloading_location,
      contact_person,
      created_at,
      material_slots!inner ( meeting_id, gate, slot_time )
    `)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })

  if (currentSlotIds.length > 0) {
    query = query.not('slot_id', 'in', `(${currentSlotIds.join(',')})`)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ previous: null })
  }

  return NextResponse.json({ previous: data })
}
