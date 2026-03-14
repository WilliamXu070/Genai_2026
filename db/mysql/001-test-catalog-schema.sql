CREATE DATABASE IF NOT EXISTS jungle_catalog;
USE jungle_catalog;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id VARCHAR(128) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  objective TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  latest_version INT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS test_versions (
  id VARCHAR(160) PRIMARY KEY,
  test_id VARCHAR(128) NOT NULL,
  version_number INT NOT NULL,
  objective TEXT NOT NULL,
  notes TEXT,
  status VARCHAR(32) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  plan_json LONGTEXT,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (test_id) REFERENCES tests(id)
);

CREATE TABLE IF NOT EXISTS test_runs (
  id VARCHAR(160) PRIMARY KEY,
  test_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  summary TEXT,
  video_path TEXT,
  source_file TEXT,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (test_id) REFERENCES tests(id)
);

CREATE TABLE IF NOT EXISTS test_artifacts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(160) NOT NULL,
  artifact_path TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES test_runs(id)
);

