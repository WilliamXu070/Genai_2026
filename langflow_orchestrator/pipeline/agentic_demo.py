from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .agentic_orchestrator import AgenticLangflowOrchestrator


def _safe_print_text(text: str) -> None:
  try:
    print(text)
  except UnicodeEncodeError:
    sanitized = text.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
    print(sanitized)


def run_demo() -> dict:
  root = Path(__file__).resolve().parents[2]
  orchestrator = AgenticLangflowOrchestrator(str(root))
  return orchestrator.run(
    {
      "feature_goal": "Observe rotating-square ball animation and identify critical defects.",
      "environment_context": "Local Electron/Playwright project. Need execution video and defect severity.",
      "target_url": "http://127.0.0.1:8088",
      "constraints": "No destructive actions. Prefer passive observation for animation-heavy pages.",
      "severity_threshold": 8.0,
      "max_retries": 2
    }
  )


def _print_gemini_responses(result: dict[str, Any]) -> None:
  chain = ((result.get("critique") or {}).get("critic_chain") or {})
  raw = chain.get("raw_model_outputs") or {}
  diagnostics = chain.get("raw_model_diagnostics") or {}
  print("\n=== GEMINI_AGENT_RAW_RESPONSES ===")
  print(json.dumps(raw, indent=2))
  print("\n=== GEMINI_AGENT_DIAGNOSTICS ===")
  print(json.dumps(diagnostics, indent=2))
  if chain.get("detailed_text"):
    print("\n=== GEMINI_AGENT_DETAILED_TEXT ===")
    _safe_print_text(str(chain["detailed_text"]))
  if chain.get("severity"):
    print("\n=== GEMINI_AGENT_SEVERITY_PARSE ===")
    print(json.dumps(chain["severity"], indent=2))


if __name__ == "__main__":
  output = run_demo()
  _print_gemini_responses(output)
  print("\n=== ORCHESTRATION_OUTPUT ===")
  print(json.dumps(output, indent=2))
