import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 기본 GATE 목록
const DEFAULT_GATES = ['GATE A', 'GATE B']

// 기본 시간대 목록
const DEFAULT_TIME_SLOTS = [
  '07:00~08:00', '08:00~09:00', '09:00~10:00', '10:00~11:00',
  '11:00~12:00', '12:00~13:00', '13:00~14:00', '14:00~15:00',
  '15:00~16:00', '16:00~17:00', '17:00~18:00',
]

// GET /api/material-slots?meetingId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const meetingId = searchParams.get('meetingId')
  if (!meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 })

  const supabase = await createServerSupabase()

  const { data: existing } = await supabase
    .from('material_slots')
    .select('id, gate')
    .eq('meeting_id', meetingId)

  if (!existing || existing.length === 0) {
    const allSlots = DEFAULT_GATES.flatMap(gate =>
      DEFAULT_TIME_SLOTS.map(slot_time => ({ meeting_id: meetingId, gate, slot_time, max_teams: 5 }))
    )
    await supabase.from('material_slots').insert(allSlots)
  } else {
    for (const gate of DEFAULT_GATES) {
      const hasGate = existing.some(s => (s as { id: string; gate: string }).gate === gate)
      if (!hasGate) {
        await supabase.from('material_slots').insert(
          DEFAULT_TIME_SLOTS.map(slot_time => ({ meeting_id: meetingId, gate, slot_time, max_teams: 5 }))
        )
      }
    }
  }

  const { data, error } = await supabase
    .from('material_slots')
    .select(`
      *,
      material_reservations(
        id, team_id, material_description, quantity, vehicle_type, created_at,
        teams(id, name)
      )
    `)
    .eq('meeting_id', meetingId)
    .order('gate', { ascending: true })
    .order('slot_time', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/material-slots — 예약
export async function POST(req: NextRequest) {
  const { slotId, teamId, materialDescription, quantity, vehicleType } = await req.json()
  const supabase = await createServerSupabase()

  const { data: slot } = await supabase
    .from('material_slots')
    .select('max_teams, material_reservations(id)')
    .eq('id', slotId)
    .single()

  if (!slot) return NextResponse.json({ error: '슬롯을 찾을 수 없습니다' }, { status: 404 })

  const currentCount = (slot.material_reservations as unknown[]).length
  if (currentCount >= slot.max_teams) {
    return NextResponse.json({ error: '해당 시간대가 마감되었습니다' }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('material_reservations')
    .insert({ slot_id: slotId, team_id: teamId, material_description: materialDescription, quantity, vehicle_type: vehicleType })
    .select('*, teams(id, name)')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 해당 시간대에 신청하셨습니다' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

// DELETE /api/material-slots?reservationId=xxx
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reservationId = searchParams.get('reservationId')
  if (!reservationId) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('material_reservations').delete().eq('id', reservationId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
