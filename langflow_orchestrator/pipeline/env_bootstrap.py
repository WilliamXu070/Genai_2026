from __future__ import annotations

import os
from pathlib import Path


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


def load_project_env(project_root: str) -> dict[str, str]:
  root = Path(project_root).resolve()
  env_path = root / ".env"
  loaded: dict[str, str] = {}
  if not env_path.exists():
    return loaded

  for raw_line in env_path.read_text(encoding="utf-8").splitlines():
    parsed = _parse_env_line(raw_line)
    if not parsed:
      continue
    key, value = parsed
    if key in os.environ:
      continue
    os.environ[key] = value
    loaded[key] = value
  return loaded
