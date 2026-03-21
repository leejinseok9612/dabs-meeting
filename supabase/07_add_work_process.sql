-- submissions 테이블에 work_process 컬럼 추가
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS work_process TEXT;
