CREATE SCHEMA IF NOT EXISTS sandbox;

CREATE TABLE IF NOT EXISTS sandbox.projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.forests (
  forest_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES sandbox.projects(project_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_runtime_image TEXT NOT NULL,
  services JSONB NOT NULL DEFAULT '[]'::JSONB,
  start_command TEXT NOT NULL,
  base_url TEXT NOT NULL,
  health_check JSONB NOT NULL DEFAULT '{}'::JSONB,
  supported_perturbations JSONB NOT NULL DEFAULT '["none"]'::JSONB,
  observability JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.scenarios (
  scenario_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES sandbox.projects(project_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  parser_version TEXT NOT NULL,
  executor_version TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.environment_versions (
  environment_version_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES sandbox.projects(project_id) ON DELETE CASCADE,
  forest_id TEXT NOT NULL REFERENCES sandbox.forests(forest_id) ON DELETE CASCADE,
  parent_environment_version_id TEXT REFERENCES sandbox.environment_versions(environment_version_id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  git_commit TEXT,
  dirty_patch_ref TEXT,
  lockfile_hash TEXT,
  docker_image_digest TEXT NOT NULL,
  env_fingerprint JSONB NOT NULL DEFAULT '{}'::JSONB,
  ports JSONB NOT NULL DEFAULT '[]'::JSONB,
  working_dir TEXT,
  startup_command TEXT,
  base_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES sandbox.projects(project_id) ON DELETE CASCADE,
  forest_id TEXT NOT NULL REFERENCES sandbox.forests(forest_id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES sandbox.scenarios(scenario_id) ON DELETE CASCADE,
  environment_version_id TEXT NOT NULL REFERENCES sandbox.environment_versions(environment_version_id) ON DELETE CASCADE,
  parent_run_id TEXT REFERENCES sandbox.runs(run_id) ON DELETE SET NULL,
  run_type TEXT NOT NULL DEFAULT 'new',
  branch_name TEXT NOT NULL DEFAULT 'main',
  perturbation_profile TEXT NOT NULL DEFAULT 'none',
  source TEXT NOT NULL DEFAULT 'mcp',
  request_input JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL,
  failed_step INTEGER,
  result_summary TEXT,
  console_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  network_failures JSONB NOT NULL DEFAULT '[]'::JSONB,
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.run_steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sandbox.runs(run_id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL,
  note TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, step_index)
);

CREATE TABLE IF NOT EXISTS sandbox.artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sandbox.runs(run_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.state_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES sandbox.runs(run_id) ON DELETE CASCADE,
  db_snapshot_ref TEXT,
  auth_snapshot_ref TEXT,
  fs_snapshot_ref TEXT,
  env_resolved JSONB NOT NULL DEFAULT '{}'::JSONB,
  hotload_tier TEXT NOT NULL DEFAULT 'full',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.comparisons (
  comparison_id TEXT PRIMARY KEY,
  base_run_id TEXT NOT NULL REFERENCES sandbox.runs(run_id) ON DELETE CASCADE,
  candidate_run_id TEXT NOT NULL REFERENCES sandbox.runs(run_id) ON DELETE CASCADE,
  diff JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_runs_project ON sandbox.runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_forest ON sandbox.runs(forest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_parent ON sandbox.runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_branch ON sandbox.runs(branch_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sandbox_steps_run ON sandbox.run_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_sandbox_artifacts_run ON sandbox.artifacts(run_id);
