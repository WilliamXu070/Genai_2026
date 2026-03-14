from __future__ import annotations

import json
import os
from typing import Any, Dict
from urllib import request

from .agentic_contracts import EnvironmentSnapshot


def _extract_json(text: str) -> Dict[str, Any]:
  block_start = text.find("```json")
  if block_start >= 0:
    trimmed = text[block_start + 7 :]
    end = trimmed.find("```")
    if end >= 0:
      text = trimmed[:end]
  return json.loads(text.strip())


class OpenAIEnvironmentAgent:
  def __init__(self, model: str = "gpt-4o-mini"):
    self.model = model
    self.temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.1"))
    self.reasoning_effort = os.getenv("OPENAI_REASONING_EFFORT", "high").strip().lower()
    self.enable_reasoning_param = os.getenv("OPENAI_ENABLE_REASONING_PARAM", "0").strip() == "1"

  def _call_openai(self, prompt: str) -> Dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
      return None

    system_text = (
      "You are an environment bootstrap agent. Return strict JSON with keys: "
      "summary, resolved_target_url, candidate_urls(array), app_bootstrap(object). "
      "app_bootstrap schema: {required(bool), reason(string), workspace(string), files(array of {path, content}), "
      "install_command(string), start_command(string), startup_timeout_ms(number)}. "
      "Prefer minimal bootstrap and infer npm commands from project context."
    )
    body: Dict[str, Any] = {
      "model": self.model,
      "messages": [
        {"role": "system", "content": system_text},
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

  def plan(self, snapshot: EnvironmentSnapshot) -> Dict[str, Any]:
    prompt = (
      "Build an environment bootstrap plan for executing automated website tests.\n"
      "The URL may be missing. If so, infer candidate localhost URLs and startup commands from repo context.\n\n"
      f"SNAPSHOT:\n{json.dumps(snapshot, indent=2)}\n\n"
      "Rules:\n"
      "- if project already likely has runnable app, avoid creating files.\n"
      "- if no runnable app, provide minimal scaffold files in app_bootstrap.files.\n"
      "- include candidate_urls for probing.\n"
    )
    candidate = self._call_openai(prompt) or {}
    app_bootstrap = candidate.get("app_bootstrap")
    if not isinstance(app_bootstrap, dict):
      app_bootstrap = {
        "required": False,
        "reason": "No bootstrap generated.",
        "workspace": ".",
        "files": [],
        "install_command": "",
        "start_command": "",
        "startup_timeout_ms": 60000
      }
    candidate_urls = candidate.get("candidate_urls")
    if not isinstance(candidate_urls, list):
      candidate_urls = []
    return {
      "summary": str(candidate.get("summary", "Environment planning completed.")),
      "resolved_target_url": str(candidate.get("resolved_target_url", "") or ""),
      "candidate_urls": [str(x) for x in candidate_urls if str(x).strip()],
      "app_bootstrap": app_bootstrap
    }
