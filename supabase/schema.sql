-- ============================================================
-- DABs 회의 자료 취합 시스템 - 전체 스키마
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1. teams 테이블
CREATE TABLE IF NOT EXISTS teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  department    TEXT,
  contact_email TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. meetings 테이블
CREATE TABLE IF NOT EXISTS meetings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  date        DATE NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. submissions 테이블
CREATE TABLE IF NOT EXISTS submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  order_index      INT NOT NULL DEFAULT 0,
  file_path        TEXT,
  file_name        TEXT,
  file_size        BIGINT,
  personnel_count  INT,
  personnel_detail JSONB,
  equipment        TEXT,
  work_location    TEXT,
  work_process     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'rejected')),
  submitted_at     TIMESTAMPTZ,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 4. merged_pdfs 테이블
CREATE TABLE IF NOT EXISTS merged_pdfs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Storage 버킷 생성
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('merged', 'merged', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RLS (Row Level Security) 설정
-- ============================================================
ALTER TABLE teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merged_pdfs ENABLE ROW LEVEL SECURITY;

-- teams: 로그인 사용자 읽기 허용
CREATE POLICY "teams_read" ON teams FOR SELECT USING (true);

-- meetings: 로그인 사용자 읽기/쓰기
CREATE POLICY "meetings_read"   ON meetings FOR SELECT USING (true);
CREATE POLICY "meetings_insert" ON meetings FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "meetings_update" ON meetings FOR UPDATE USING (auth.role() = 'authenticated');

-- submissions: 읽기/쓰기 허용
CREATE POLICY "submissions_read"   ON submissions FOR SELECT USING (true);
CREATE POLICY "submissions_insert" ON submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "submissions_update" ON submissions FOR UPDATE USING (true);
CREATE POLICY "submissions_delete" ON submissions FOR DELETE USING (true);

-- merged_pdfs: 읽기 허용
CREATE POLICY "merged_pdfs_read"   ON merged_pdfs FOR SELECT USING (true);
CREATE POLICY "merged_pdfs_insert" ON merged_pdfs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Storage 정책
CREATE POLICY "submissions_upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'submissions');
CREATE POLICY "submissions_download" ON storage.objects FOR SELECT USING (bucket_id = 'submissions');
CREATE POLICY "merged_upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'merged');
CREATE POLICY "merged_download" ON storage.objects FOR SELECT USING (bucket_id = 'merged');

-- ============================================================
-- 팀 초기 데이터 삽입
-- ============================================================
INSERT INTO teams (name, department) VALUES
  ('천호엔지니어링', NULL),
  ('참마루건설', NULL),
  ('지디건설', NULL)
ON CONFLICT DO NOTHING;
