USE jungle_agentic;

ALTER TABLE test_runs
  MODIFY COLUMN status ENUM(
    'drafting',
    'to_be_approved',
    'approved',
    'in_progress',
    'passed',
    'failed',
    'max_loops_reached',
    'completed',
    'failed_execution',
    'cancelled'
  ) NOT NULL DEFAULT 'drafting';

UPDATE test_runs
SET status = 'completed'
WHERE status IN ('passed', 'max_loops_reached');

UPDATE test_runs
SET status = 'failed_execution'
WHERE status = 'failed';

ALTER TABLE test_runs
  MODIFY COLUMN status ENUM(
    'drafting',
    'to_be_approved',
    'approved',
    'in_progress',
    'completed',
    'failed_execution',
    'cancelled'
  ) NOT NULL DEFAULT 'drafting';

SET @has_test_runs_semantic_verdict := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'test_runs'
    AND column_name = 'semantic_verdict'
);
SET @sql := IF(
  @has_test_runs_semantic_verdict = 0,
  'ALTER TABLE test_runs ADD COLUMN semantic_verdict VARCHAR(32) NULL AFTER draft_payload_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_test_runs_semantic_interpretation_json := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'test_runs'
    AND column_name = 'semantic_interpretation_json'
);
SET @sql := IF(
  @has_test_runs_semantic_interpretation_json = 0,
  'ALTER TABLE test_runs ADD COLUMN semantic_interpretation_json JSON NULL AFTER semantic_verdict',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_test_runs_semantic_verdict := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'test_runs'
    AND index_name = 'idx_test_runs_semantic_verdict'
);
SET @sql := IF(
  @has_idx_test_runs_semantic_verdict = 0,
  'CREATE INDEX idx_test_runs_semantic_verdict ON test_runs(semantic_verdict, updated_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
