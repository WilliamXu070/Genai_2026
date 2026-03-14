from __future__ import annotations

from typing import Any, Dict, List

from .contracts import Inspection, NormalizedInput, OrchestrationInput, Procedure, RequestParser


def normalize_input(payload: OrchestrationInput) -> NormalizedInput:
  url = (payload.get("url") or "").strip()
  if not url:
    raise ValueError("url is required")

  task = (payload.get("task") or "").strip()
  objective = (payload.get("objective") or "").strip() or task or "Validate critical user flow"

  return {
    "projectName": (payload.get("projectName") or "Jungle").strip(),
    "url": url,
    "task": task,
    "objective": objective,
    "notes": (payload.get("notes") or "").strip(),
    "additions": (payload.get("additions") or "").strip(),
    "forestId": payload.get("forestId"),
    "skipCodex": bool(payload.get("skipCodex", True)),
    "codexTimeoutMs": int(payload.get("codexTimeoutMs", 120000))
  }


def is_valid_procedure(plan: Dict[str, Any]) -> bool:
  if not isinstance(plan, dict):
    return False
  steps = plan.get("steps")
  if not isinstance(steps, list) or len(steps) == 0:
    return False
  return all(isinstance(step, dict) and step.get("action") and step.get("target") for step in steps)


def fallback_procedure(inspection: Inspection, normalized: NormalizedInput) -> Procedure:
  heading = (inspection.get("headings") or [inspection.get("title") or "main page"])[0]
  button_target = (inspection.get("buttonSelectors") or [f"text={((inspection.get('buttons') or ['Submit'])[0])}"])[0]
  state_target = (inspection.get("textTargets") or ["body"])[0]

  return {
    "summary": f"Validate {heading} flow and core interactions for objective: {normalized['objective']}",
    "confirmMessage": "Confirm generated procedure before execution.",
    "steps": [
      {"action": "goto", "target": inspection.get("url") or normalized["url"]},
      {"action": "assertVisible", "target": f"text={heading}"},
      {"action": "captureText", "target": state_target, "value": "beforeState"},
      {"action": "click", "target": button_target},
      {"action": "assertChanged", "target": state_target, "value": "beforeState"},
      {"action": "screenshot", "target": "fullPage"}
    ],
    "notes": normalized.get("notes", "")
  }


def choose_procedure(plan: Dict[str, Any], inspection: Inspection, normalized: NormalizedInput) -> Procedure:
  if is_valid_procedure(plan):
    return {
      "summary": plan.get("summary") or f"Validate objective: {normalized['objective']}",
      "confirmMessage": plan.get("confirmMessage") or "Confirm generated procedure before execution.",
      "steps": plan.get("steps") or [],
      "notes": plan.get("notes") or normalized.get("notes", "")
    }
  return fallback_procedure(inspection, normalized)


def build_request_parser(procedure: Procedure) -> RequestParser:
  normalized_steps: List[Dict[str, Any]] = []
  for idx, step in enumerate(procedure.get("steps") or []):
    normalized_steps.append(
      {
        "index": idx,
        "action": step.get("action"),
        "target": step.get("target"),
        "value": step.get("value"),
        "assert": step.get("assert")
      }
    )

  return {"parserVersion": "0.1.0", "normalizedSteps": normalized_steps}


def generate_executor(parser: RequestParser) -> Dict[str, Any]:
  return {
    "name": "playwright_executor.generated.js",
    "format": "javascript",
    "description": "Executor source can be generated downstream from normalized steps.",
    "stepCount": len(parser.get("normalizedSteps") or []),
    "actions": [step.get("action") for step in (parser.get("normalizedSteps") or [])]
  }


def normalize_artifacts(artifacts: List[Dict[str, Any]]) -> List[Dict[str, str]]:
  normalized: List[Dict[str, str]] = []
  for artifact in artifacts or []:
    path = str(artifact.get("path", "")).strip()
    if not path:
      continue
    normalized.append({"type": str(artifact.get("type") or "artifact"), "path": path})
  return normalized

