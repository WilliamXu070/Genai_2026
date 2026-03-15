from __future__ import annotations

import os
from pathlib import Path

from .runtime_paths import resolve_project_root, resolve_storage_root


def _parse_env_line(line: str) -> tuple[str, str] | None:
  text = line.strip()
  if not text or text.startswith("#"):
    return None
  if text.startswith("export "):
    text = text[len("export ") :].strip()
  if "=" not in text:
    return None
  key, value = text.split("=", 1)
  key = key.strip()
  value = value.strip()
  if not key:
    return None
  if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
    value = value[1:-1]
  return key, value


def _load_env_file(env_path: Path, loaded: dict[str, str]) -> None:
  if not env_path.exists():
    return

  for raw_line in env_path.read_text(encoding="utf-8").splitlines():
    parsed = _parse_env_line(raw_line)
    if not parsed:
      continue
    key, value = parsed
    if key in os.environ:
      continue
    os.environ[key] = value
    loaded[key] = value


def load_project_env(project_root: str) -> dict[str, str]:
  root = resolve_project_root(project_root)
  storage_root = resolve_storage_root(project_root)
  repo_root = Path(__file__).resolve().parents[2]
  loaded: dict[str, str] = {}

  # Load Jungle repo env first so shared model/database credentials are available
  # even when the target project root points at a separate demo app directory.
  _load_env_file(repo_root / ".env", loaded)
  if storage_root not in {repo_root, root}:
    _load_env_file(storage_root / ".env", loaded)
  if root != repo_root:
    _load_env_file(root / ".env", loaded)

  return loaded
