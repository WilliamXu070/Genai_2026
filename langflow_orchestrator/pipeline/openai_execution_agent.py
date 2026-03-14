from __future__ import annotations

import json
import os
from typing import Any, Dict
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
    prompt = (
      "Build an execution-ready Playwright plan using the repository context and environment snapshot.\n\n"
      f"SNAPSHOT:\n{json.dumps(snapshot, indent=2)}\n\n"
      "Requirements:\n"
      "- include app_bootstrap instructions when app creation/startup might be needed\n"
      "- include at least one visibility assertion\n"
      "- include observation wait for animation-heavy pages (>=10000ms)\n"
      "- include final screenshot\n"
      "- avoid click/fill if controls are absent\n"
    )

    candidate = self._call_openai(prompt)
    if not candidate:
      return fallback_execution_plan(snapshot)

    steps = candidate.get("steps")
    if not isinstance(steps, list) or len(steps) == 0:
      return fallback_execution_plan(snapshot)

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

    return {
      "objective": candidate.get("objective") or snapshot.get("feature_goal", "Validate feature"),
      "rationale": candidate.get("rationale", ""),
      "app_bootstrap": app_bootstrap,
      "steps": steps,
      "assertions": candidate.get("assertions", []),
      "success_criteria": candidate.get("success_criteria", [])
    }
