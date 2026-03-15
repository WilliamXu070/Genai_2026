USE jungle_agentic;

UPDATE test_runs
SET status = 'to_be_approved'
WHERE status = 'queued';

ALTER TABLE test_runs
  MODIFY COLUMN status ENUM(
    'drafting',
    'to_be_approved',
    'approved',
    'in_progress',
    'passed',
    'failed',
    'max_loops_reached',
    'cancelled'
  ) NOT NULL DEFAULT 'drafting';

ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS approval_requested_at DATETIME NULL AFTER last_error_text,
  ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL AFTER approval_requested_at,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL AFTER approved_at,
  ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL AFTER approved_by,
  ADD COLUMN IF NOT EXISTS draft_payload_json JSON NULL AFTER cancelled_at;

SET @has_idx_test_runs_status_updated_at := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'test_runs'
    AND index_name = 'idx_test_runs_status_updated_at'
);
SET @sql := IF(
  @has_idx_test_runs_status_updated_at = 0,
  'CREATE INDEX idx_test_runs_status_updated_at ON test_runs(status, updated_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_test_runs_project_status_created_at := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'test_runs'
    AND index_name = 'idx_test_runs_project_status_created_at'
);
SET @sql := IF(
  @has_idx_test_runs_project_status_created_at = 0,
  'CREATE INDEX idx_test_runs_project_status_created_at ON test_runs(project_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
