from __future__ import annotations

import os
from pathlib import Path


def resolve_project_root(project_root: str) -> Path:
  return Path(project_root).expanduser().resolve()


def resolve_storage_root(project_root: str) -> Path:
  explicit_root = os.getenv("JUNGLE_STORAGE_ROOT", "").strip()
  if explicit_root:
    return Path(explicit_root).expanduser().resolve()
  return resolve_project_root(project_root)


def resolve_langflow_runs_dir(project_root: str) -> Path:
  return resolve_storage_root(project_root) / "db" / "langflow_agentic_runs"
