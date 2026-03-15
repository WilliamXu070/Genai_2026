USE jungle_agentic;

ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS preview_type VARCHAR(32) NULL AFTER video_reference,
  ADD COLUMN IF NOT EXISTS preview_path TEXT NULL AFTER preview_type,
  ADD COLUMN IF NOT EXISTS preview_title VARCHAR(255) NULL AFTER preview_path;
