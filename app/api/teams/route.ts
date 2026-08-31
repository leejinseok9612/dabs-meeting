import { createServerSupabase } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/teams — 전체 팀 목록 (지도 범례, 색상 배정용)
export async function GET() {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, department')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
