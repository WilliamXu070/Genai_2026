from __future__ import annotations

import json
import os
from typing import Any, Dict, List
from urllib import request

from .agentic_contracts import EnvironmentSnapshot, ExecutionPlan
from .agentic_tools import fallback_execution_plan


def _extract_json(text: str) -> Dict[str, Any]:
  block_start = text.find("```json")
  if block_start >= 0:
    trimmed = text[block_start + 7 :]
    end = trimmed.find("```")
    if end >= 0:
      text = trimmed[:end]
  return json.loads(text.strip())


def _is_placeholder_target(target: Any) -> bool:
  t = str(target or "").strip().lower()
  if not t:
    return True
  placeholder_tokens = ["selector-for-", "todo", "tbd", "replace-me", "example selector", "example_selector"]
  return any(token in t for token in placeholder_tokens)


def _is_invalid_step_target(step: Dict[str, Any]) -> bool:
  action = str(step.get("action", "")).strip().lower()
  target = step.get("target")
  if action == "wait":
    value = step.get("value")
    try:
      return int(value) <= 0
    except Exception:
      return True
  if action == "screenshot":
    if target is None or str(target).strip() == "":
      return False
  return _is_placeholder_target(target)


def _step_matches(step: Dict[str, Any], action: str, target: str) -> bool:
  return str(step.get("action", "")).strip().lower() == action.lower() and str(step.get("target", "")).strip() == target


def _ensure_coverage_steps(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
  normalized_steps = list(steps or [])
  has_scroll = any(str(step.get("action", "")).strip().lower() == "scrollpage" for step in normalized_steps)
  has_screenshot = any(str(step.get("action", "")).strip().lower() == "screenshot" for step in normalized_steps)

  if not has_scroll:
    normalized_steps.append({"action": "scrollPage", "target": "down"})
  if not has_screenshot:
    normalized_steps.append({"action": "screenshot", "target": "fullPage"})
  return normalized_steps


def _inject_required_interactions(steps: List[Dict[str, Any]], required: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
  normalized_steps = list(steps or [])
  insert_index = 0
  for idx, step in enumerate(normalized_steps):
    if str(step.get("action", "")).strip().lower() == "goto":
      insert_index = idx + 1
      break

  for interaction in required:
    action = str(interaction.get("action", "")).strip()
    target = str(interaction.get("target", "")).strip()
    if not action or not target:
      continue
    if any(_step_matches(step, action, target) for step in normalized_steps):
      continue

    normalized_steps.insert(insert_index, {"action": action, "target": target})
    insert_index += 1
  return normalized_steps


class OpenAIExecutionAgent:
  def __init__(self, model: str = "gpt-4o-mini", max_turns: int = 3):
    self.model = model
    self.max_turns = max_turns
    self.reasoning_effort = os.getenv("OPENAI_REASONING_EFFORT", "high").strip().lower()
    self.temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.1"))
    self.enable_reasoning_param = os.getenv("OPENAI_ENABLE_REASONING_PARAM", "0").strip() == "1"

  def _call_openai(self, prompt: str) -> Dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
      return None

    system_text = (
      "You are an execution-planning agent. Return strict JSON only with keys: "
      "objective, rationale, app_bootstrap(object), steps(array), assertions(array), success_criteria(array). "
      "app_bootstrap schema: {required(bool), reason(string), workspace(string), files(array of {path, content}), install_command(string), start_command(string), startup_timeout_ms(number)}. "
      "If the target app may not exist or localhost may be down, provide concrete app_bootstrap instructions to create/start it. "
      "Steps actions must be one of: goto, assertVisible, captureText, click, fill, wait, assertChanged, scrollPage, screenshot. "
      f"Reasoning effort target: {self.reasoning_effort}. Think deeply, then return only final JSON."
    )
    body = {
      "model": self.model,
      "messages": [
        {
          "role": "system",
          "content": system_text
        },
        {"role": "user", "content": prompt}
      ],
      "temperature": self.temperature
    }
    if self.enable_reasoning_param and self.reasoning_effort in {"low", "medium", "high"}:
      body["reasoning"] = {"effort": self.reasoning_effort}
    req = request.Request(
      "https://api.openai.com/v1/chat/completions",
      method="POST",
      data=json.dumps(body).encode("utf-8"),
      headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
      }
    )
    try:
      with request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
      content = payload["choices"][0]["message"]["content"]
      return _extract_json(content)
    except Exception:
      return None

  def plan(self, snapshot: EnvironmentSnapshot) -> ExecutionPlan:
    required_interactions = snapshot.get("required_interactions")
    if not isinstance(required_interactions, list):
      required_interactions = []
    def finalize(plan: ExecutionPlan) -> ExecutionPlan:
      steps = plan.get("steps")
      if isinstance(steps, list):
        plan["steps"] = _ensure_coverage_steps(_inject_required_interactions(steps, required_interactions))
      return plan

    prompt = (
      "Build an execution-ready Playwright plan using the repository context and environment snapshot.\n\n"
      f"SNAPSHOT:\n{json.dumps(snapshot, indent=2)}\n\n"
      "Requirements:\n"
      "- include app_bootstrap instructions when app creation/startup might be needed\n"
      "- include at least one visibility assertion\n"
      "- include observation wait for animation-heavy pages (>=10000ms)\n"
      "- default to broad coverage when user scope is not narrow: click all discovered controls, then scroll the full page\n"
      "- include final screenshot\n"
      "- use only selectors grounded in snapshot key_files/button_controls (no placeholder selectors)\n"
      "- if snapshot.required_interactions is non-empty, include those steps before assertions\n"
      "- when a simulation requires user activation (e.g., Start/Toggle button), click it before wait/assert steps\n"
      "- avoid click/fill only when controls are truly absent from provided context\n"
      "- for wait steps, set milliseconds in step.value (not step.target)\n"
    )

    candidate = self._call_openai(prompt)
    if not candidate:
      return finalize(fallback_execution_plan(snapshot))

    steps = candidate.get("steps")
    if not isinstance(steps, list) or len(steps) == 0:
      return finalize(fallback_execution_plan(snapshot))
    if any(_is_invalid_step_target(step) for step in steps):
      return finalize(fallback_execution_plan(snapshot))
    steps = _inject_required_interactions(steps, required_interactions)

    app_bootstrap = candidate.get("app_bootstrap")
    if not isinstance(app_bootstrap, dict):
      app_bootstrap = {
        "required": False,
        "reason": "No bootstrap instructions provided by planner.",
        "workspace": ".",
        "files": [],
        "install_command": "",
        "start_command": "",
        "startup_timeout_ms": 60000
      }

    return finalize(
      {
      "objective": candidate.get("objective") or snapshot.get("feature_goal", "Validate feature"),
      "rationale": candidate.get("rationale", ""),
      "app_bootstrap": app_bootstrap,
      "steps": steps,
      "assertions": candidate.get("assertions", []),
      "success_criteria": candidate.get("success_criteria", [])
      }
    )
