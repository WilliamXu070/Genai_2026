CREATE DATABASE IF NOT EXISTS jungle_agentic;
USE jungle_agentic;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_runs (
  id VARCHAR(96) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  execution_time_ms INT NULL,
  loop_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('queued','in_progress','passed','failed','max_loops_reached') NOT NULL DEFAULT 'queued',
  testing_instructions TEXT NOT NULL,
  video_reference TEXT NULL,
  three_point_summary_json JSON NOT NULL,
  last_error_text TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_test_runs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT chk_test_runs_loop_count CHECK (loop_count <= 3),
  CONSTRAINT chk_three_point_summary_array CHECK (JSON_VALID(three_point_summary_json) AND JSON_TYPE(three_point_summary_json) = 'ARRAY' AND JSON_LENGTH(three_point_summary_json) = 3)
);

CREATE TABLE IF NOT EXISTS loop_iterations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  test_run_id VARCHAR(96) NOT NULL,
  loop_number TINYINT UNSIGNED NOT NULL,
  status ENUM('running','passed','failed') NOT NULL,
  step_summary TEXT NULL,
  artifacts_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_loop_iterations_run FOREIGN KEY (test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE,
  CONSTRAINT chk_loop_number CHECK (loop_number >= 1 AND loop_number <= 3),
  CONSTRAINT chk_artifacts_json CHECK (JSON_VALID(artifacts_json)),
  UNIQUE KEY uq_loop_iterations_run_loop (test_run_id, loop_number)
);

CREATE INDEX idx_test_runs_project_created_at ON test_runs(project_id, created_at);
CREATE INDEX idx_loop_iterations_test_run_loop_number ON loop_iterations(test_run_id, loop_number);