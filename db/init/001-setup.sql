CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

-- Updated baseline schema to mirror current JSON-backed runtime models.

CREATE TABLE IF NOT EXISTS app.runtime_runs (
  run_id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL DEFAULT 'Jungle Project',
  scenario_name TEXT NOT NULL DEFAULT 'MVP scenario',
  status TEXT NOT NULL DEFAULT 'starting',
  command TEXT NOT NULL DEFAULT 'npm start',
  url TEXT NOT NULL DEFAULT 'http://127.0.0.1:3000',
  perturbation_profile TEXT NOT NULL DEFAULT 'none',
  result_summary TEXT,
  failed_step INTEGER,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.runtime_run_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES app.runtime_runs(run_id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, step_index)
);

CREATE TABLE IF NOT EXISTS app.runtime_artifacts (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES app.runtime_runs(run_id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL DEFAULT 'artifact',
  artifact_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.agentic_forests (
  forest_id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL DEFAULT 'Jungle Project',
  url TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'Generate and execute generalized Playwright tests',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.agentic_trees (
  tree_id TEXT PRIMARY KEY,
  forest_id TEXT NOT NULL REFERENCES app.agentic_forests(forest_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  procedure JSONB NOT NULL,
  request_parser JSONB NOT NULL,
  execution_profile JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_run_id TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (forest_id, version)
);

CREATE TABLE IF NOT EXISTS app.agentic_runs (
  run_id TEXT PRIMARY KEY,
  forest_id TEXT NOT NULL REFERENCES app.agentic_forests(forest_id) ON DELETE CASCADE,
  tree_id TEXT NOT NULL REFERENCES app.agentic_trees(tree_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  summary TEXT,
  video_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.agentic_run_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES app.agentic_runs(run_id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, step_index)
);

CREATE TABLE IF NOT EXISTS app.agentic_artifacts (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES app.agentic_runs(run_id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL DEFAULT 'artifact',
  artifact_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_runs_created_at ON app.runtime_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_steps_run_id ON app.runtime_run_steps (run_id);
CREATE INDEX IF NOT EXISTS idx_runtime_artifacts_run_id ON app.runtime_artifacts (run_id);
CREATE INDEX IF NOT EXISTS idx_agentic_forests_created_at ON app.agentic_forests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agentic_trees_forest_id ON app.agentic_trees (forest_id);
CREATE INDEX IF NOT EXISTS idx_agentic_runs_forest_id ON app.agentic_runs (forest_id);
CREATE INDEX IF NOT EXISTS idx_agentic_runs_tree_id ON app.agentic_runs (tree_id);
CREATE INDEX IF NOT EXISTS idx_agentic_steps_run_id ON app.agentic_run_steps (run_id);
CREATE INDEX IF NOT EXISTS idx_agentic_artifacts_run_id ON app.agentic_artifacts (run_id);
