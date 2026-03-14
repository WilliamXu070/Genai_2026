from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

from .agentic_orchestrator import AgenticLangflowOrchestrator


def _load_payload(args: argparse.Namespace) -> Dict[str, Any]:
  if args.input_file:
    return json.loads(Path(args.input_file).read_text(encoding="utf-8"))
  if args.input_stdin:
    return json.loads(sys.stdin.read())
  if args.input_json:
    return json.loads(args.input_json)
  raise ValueError("Provide one of --input-json, --input-file, or --input-stdin")


def main() -> int:
  parser = argparse.ArgumentParser(description="Run agentic Langflow orchestrator from CLI.")
  parser.add_argument("--input-json", default="", help="Inline JSON payload string.")
  parser.add_argument("--input-file", default="", help="Path to JSON payload file.")
  parser.add_argument("--input-stdin", action="store_true", help="Read JSON payload from stdin.")
  parser.add_argument("--project-root", default="", help="Project root override.")
  args = parser.parse_args()

  payload = _load_payload(args)
  if args.project_root:
    payload["project_root"] = args.project_root

  root = Path(payload.get("project_root") or Path(__file__).resolve().parents[2]).resolve()
  orchestrator = AgenticLangflowOrchestrator(str(root))
  out = orchestrator.run(payload)
  print(json.dumps(out))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
