-- ============================================================
-- DABs v2 — 지적도 마커 테이블 (드래그&드롭 협업 지도)
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

CREATE TABLE IF NOT EXISTS map_markers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id),
  marker_type TEXT NOT NULL,   -- 'excavator', 'crane', 'dump_truck', ...
  x_pct       REAL NOT NULL,   -- 0~100 (지도 너비 대비 %)
  y_pct       REAL NOT NULL,   -- 0~100 (지도 높이 대비 %)
  label       TEXT,            -- 선택적 라벨
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE map_markers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "map_markers_read"   ON map_markers FOR SELECT USING (true);
CREATE POLICY "map_markers_insert" ON map_markers FOR INSERT WITH CHECK (true);
CREATE POLICY "map_markers_delete" ON map_markers FOR DELETE USING (true);
