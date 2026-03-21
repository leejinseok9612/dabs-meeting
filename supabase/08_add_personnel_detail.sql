-- ============================================================
-- 08_add_personnel_detail.sql
-- 인원 세부 정보 컬럼 추가 (고령자/초고령자/외국인/여성/유질환자)
-- ============================================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS personnel_detail JSONB;

-- 예시 구조:
-- {
--   "elderly":      5,   -- 고령자
--   "superElderly": 2,   -- 초고령자
--   "foreign":      3,   -- 외국인 근로자
--   "female":       4,   -- 여성 근로자
--   "diseased":     1    -- 유질환자
-- }
