-- ============================================================
-- DABs v2 — 신규 기능 스키마 추가
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1. meetings 테이블에 지도 첨부 컬럼 추가
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS map_file_url  TEXT,
  ADD COLUMN IF NOT EXISTS map_file_name TEXT;

-- 2. 공지사항 테이블
CREATE TABLE IF NOT EXISTS announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "announcements_read"   ON announcements FOR SELECT USING (true);
CREATE POLICY "announcements_insert" ON announcements FOR INSERT WITH CHECK (true);
CREATE POLICY "announcements_update" ON announcements FOR UPDATE USING (true);
CREATE POLICY "announcements_delete" ON announcements FOR DELETE USING (true);

-- 3. 작업 항목 (고위험/일반 공동작업)
CREATE TABLE IF NOT EXISTS work_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  work_type    TEXT NOT NULL CHECK (work_type IN ('high_risk', 'general')),
  team_id      UUID REFERENCES teams(id),
  work_name    TEXT NOT NULL,
  location     TEXT,
  worker_count INT DEFAULT 0,
  description  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_items_read"   ON work_items FOR SELECT USING (true);
CREATE POLICY "work_items_insert" ON work_items FOR INSERT WITH CHECK (true);
CREATE POLICY "work_items_update" ON work_items FOR UPDATE USING (true);
CREATE POLICY "work_items_delete" ON work_items FOR DELETE USING (true);

-- 4. 자재 하역/운반 시간대 슬롯
CREATE TABLE IF NOT EXISTS material_slots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  slot_time  TEXT NOT NULL,   -- 예) '07:00~08:00'
  max_teams  INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (meeting_id, slot_time)
);

ALTER TABLE material_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "material_slots_read"   ON material_slots FOR SELECT USING (true);
CREATE POLICY "material_slots_insert" ON material_slots FOR INSERT WITH CHECK (true);
CREATE POLICY "material_slots_update" ON material_slots FOR UPDATE USING (true);
CREATE POLICY "material_slots_delete" ON material_slots FOR DELETE USING (true);

-- 5. 자재 예약
CREATE TABLE IF NOT EXISTS material_reservations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id              UUID NOT NULL REFERENCES material_slots(id) ON DELETE CASCADE,
  team_id              UUID NOT NULL REFERENCES teams(id),
  material_description TEXT,
  quantity             TEXT,
  vehicle_type         TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (slot_id, team_id)
);

ALTER TABLE material_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "material_res_read"   ON material_reservations FOR SELECT USING (true);
CREATE POLICY "material_res_insert" ON material_reservations FOR INSERT WITH CHECK (true);
CREATE POLICY "material_res_update" ON material_reservations FOR UPDATE USING (true);
CREATE POLICY "material_res_delete" ON material_reservations FOR DELETE USING (true);

-- 6. maps 스토리지 버킷
INSERT INTO storage.buckets (id, name, public)
VALUES ('maps', 'maps', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "maps_upload"   ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'maps');
CREATE POLICY "maps_download" ON storage.objects FOR SELECT USING (bucket_id = 'maps');
CREATE POLICY "maps_delete"   ON storage.objects FOR DELETE USING (bucket_id = 'maps');
