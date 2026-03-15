from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, Dict
from urllib import error
from urllib import request

from .agentic_contracts import CritiqueResult, ExecutionPlan, ExecutionResult


def _extract_json(text: str) -> Dict[str, Any]:
  block_start = text.find("```json")
  if block_start >= 0:
    trimmed = text[block_start + 7 :]
    end = trimmed.find("```")
    if end >= 0:
      text = trimmed[:end]
  return json.loads(text.strip())


def _summarize_plan_and_execution(plan: ExecutionPlan, execution: ExecutionResult) -> str:
  plan_steps = plan.get("steps") or []
  execution_steps = execution.get("steps") or []
  assertions = plan.get("assertions") or []
  success_criteria = plan.get("success_criteria") or []

  serialized_plan_steps = []
  for index, step in enumerate(plan_steps, start=1):
    action = str(step.get("action", "step"))
    target = str(step.get("target", ""))
    value = step.get("value")
    detail = f"{index}. {action} {target}".strip()
    if value not in (None, ""):
      detail += f" value={value}"
    serialized_plan_steps.append(detail)

  serialized_execution_steps = []
  for index, step in enumerate(execution_steps, start=1):
    action = str(step.get("action", "step"))
    target = str(step.get("target", ""))
    status = str(step.get("status", "unknown"))
    note = str(step.get("note", "")).strip()
    detail = f"{index}. {action} {target} => status={status}".strip()
    if note:
      detail += f" note={note}"
    serialized_execution_steps.append(detail)

  sections = [
    f"Objective: {plan.get('objective', '')}",
    "Planned feature steps:",
    "\n".join(serialized_plan_steps) if serialized_plan_steps else "none recorded",
    "Assertions to evaluate:",
    "\n".join(f"- {item}" for item in assertions) if assertions else "- none recorded",
    "Success criteria:",
    "\n".join(f"- {item}" for item in success_criteria) if success_criteria else "- none recorded",
    "Observed execution steps:",
    "\n".join(serialized_execution_steps) if serialized_execution_steps else "none recorded",
    f"Execution summary: {execution.get('summary', '')}",
    "Critic scope rule: only flag issues that relate to the requested objective, planned steps, assertions, or success criteria. Do not invent unrelated defects outside this feature scope."
  ]
  return "\n\n".join(sections)


def deterministic_critique(plan: ExecutionPlan, execution: ExecutionResult) -> CritiqueResult:
  defects = []
  strengths = []
  recs = []

  video_path = execution.get("video_path")
  video_size = 0
  if video_path and Path(video_path).exists():
    video_size = Path(video_path).stat().st_size

  if execution.get("status") != "pass":
    defects.append(
      {
        "id": "execution_failed",
        "severity_0_10": 9.0,
        "description": "Playwright execution failed.",
        "evidence": execution.get("summary", "unknown failure"),
        "recommendation": "Fix broken selector/action and rerun with more deterministic assertions."
      }
    )
  else:
    strengths.append("Execution finished without runtime failure.")

  if not video_path:
    defects.append(
      {
        "id": "video_missing",
        "severity_0_10": 8.5,
        "description": "Execution video was not generated.",
        "evidence": "video_path is null",
        "recommendation": "Ensure Playwright recordVideo is enabled and artifact collection is wired."
      }
    )
  elif video_size < 50_000:
    defects.append(
      {
        "id": "video_too_short_or_sparse",
        "severity_0_10": 7.8,
        "description": "Video exists but appears too small for reliable visual interpretation.",
        "evidence": f"size_bytes={video_size}",
        "recommendation": "Increase observation window and action delay before judging animation quality."
      }
    )
  else:
    strengths.append("Video artifact captured with sufficient size for review.")

  has_wait = any(str(step.get("action", "")).lower() == "wait" for step in (plan.get("steps") or []))
  if not has_wait:
    defects.append(
      {
        "id": "missing_observation_window",
        "severity_0_10": 6.5,
        "description": "Plan lacks a dedicated passive observation period for animation defects.",
        "evidence": "No wait step found in plan.",
        "recommendation": "Add a wait step (>=10000ms) before final assertions."
      }
    )
  else:
    strengths.append("Plan includes passive observation window.")

  overall = max([d["severity_0_10"] for d in defects], default=2.0)
  verdict = "fail" if overall > 8.0 else "pass"
  if defects:
    recs.extend([d["recommendation"] for d in defects])

  return {
    "verdict": verdict,
    "overall_severity": float(overall),
    "summary": "Deterministic visual-critique baseline.",
    "defects": defects,
    "strengths": strengths,
    "recommendations": recs,
    "source": "deterministic"
  }


class GeminiCriticAgent:
  def __init__(self, model: str = "gemini-2.5-pro"):
    self.model = os.getenv("GEMINI_MODEL", model).strip()
    self.temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
    self.max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "8192"))
    self.chain_passes = max(1, min(3, int(os.getenv("CRITIC_CHAIN_PASSES", "3"))))

  def _call_gemini_parts(self, parts: list[dict[str, Any]]) -> tuple[str | None, Dict[str, Any]]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
      return None, {"ok": False, "reason": "missing_gemini_api_key"}

    body = {
      "contents": [{"role": "user", "parts": parts}],
      "generationConfig": {
        "temperature": self.temperature,
        "maxOutputTokens": self.max_output_tokens
      }
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={api_key}"
    req = request.Request(
      url,
      method="POST",
      data=json.dumps(body).encode("utf-8"),
      headers={"Content-Type": "application/json"}
    )
    try:
      with request.urlopen(req, timeout=120) as resp:
        status_code = getattr(resp, "status", 200)
        raw = resp.read().decode("utf-8")
      payload = json.loads(raw)
      text = payload["candidates"][0]["content"]["parts"][0]["text"]
      return text, {"ok": True, "status_code": status_code}
    except error.HTTPError as exc:
      response_body = ""
      try:
        response_body = exc.read().decode("utf-8")
      except Exception:
        response_body = "<unreadable_http_error_body>"
      return None, {
        "ok": False,
        "reason": "http_error",
        "status_code": exc.code,
        "response_body": response_body[:3000]
      }
    except json.JSONDecodeError as exc:
      return None, {"ok": False, "reason": "invalid_json_response", "error": str(exc)}
    except KeyError as exc:
      return None, {"ok": False, "reason": "unexpected_response_shape", "error": str(exc)}
    except Exception as exc:
      return None, {"ok": False, "reason": "exception", "error": str(exc)}

  def _build_video_part(self, execution: ExecutionResult, max_bytes: int = 18_000_000) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    video_path = execution.get("video_path")
    if not video_path:
      return None, {"video_input_used": False, "video_reason": "missing_video_path", "video_bytes": 0}

    p = Path(str(video_path))
    if not p.exists():
      return None, {"video_input_used": False, "video_reason": "video_file_missing", "video_bytes": 0}

    size = p.stat().st_size
    if size <= 0:
      return None, {"video_input_used": False, "video_reason": "video_empty", "video_bytes": size}
    if size > max_bytes:
      return None, {"video_input_used": False, "video_reason": "video_too_large_for_inline", "video_bytes": size}

    encoded = base64.b64encode(p.read_bytes()).decode("ascii")
    return {
      "inline_data": {
        "mime_type": "video/webm",
        "data": encoded
      }
    }, {"video_input_used": True, "video_reason": "inline_video_attached", "video_bytes": size}

  def _coerce_critique_shape(self, payload: Dict[str, Any], baseline: CritiqueResult) -> CritiqueResult:
    return {
      "verdict": payload.get("verdict", baseline["verdict"]),
      "overall_severity": float(payload.get("overall_severity", baseline["overall_severity"])),
      "summary": payload.get("summary", baseline["summary"]),
      "defects": payload.get("defects", baseline["defects"]),
      "strengths": payload.get("strengths", baseline["strengths"]),
      "recommendations": payload.get("recommendations", baseline["recommendations"]),
      "source": payload.get("source", "gemini")
    }

  def critique(self, plan: ExecutionPlan, execution: ExecutionResult) -> CritiqueResult:
    baseline = deterministic_critique(plan, execution)
    video_part, video_meta = self._build_video_part(execution)
    context_summary = _summarize_plan_and_execution(plan, execution)
    stage_outputs: Dict[str, Any] = {
      "stage1_text": None,
      "stage2_text": None,
      "stage3_text": None
    }
    stage_diagnostics: Dict[str, Any] = {
      "stage1": None,
      "stage2": None,
      "stage3": None
    }

    stage1_prompt = (
      "You are a strict UI/UX test critic.\n"
      "Review this execution video only in the context of the requested feature scope.\n"
      "Your job is to identify which requested feature behaviors worked, which failed, and which were not actually exercised.\n"
      "Do not invent defects outside the planned feature scope.\n"
      "Be comprehensive and technical. Use numbered sections exactly like:\n"
      "1) Problem Name\n"
      "What happens\n"
      "Why it looks wrong\n"
      "Fix\n\n"
      "If the video does not show a requested feature being exercised, say that the result is inconclusive for that feature rather than inventing a failure.\n"
      "Tie every critique item back to a planned step, assertion, success criterion, or observed execution step.\n"
      f"FEATURE CONTEXT:\n{context_summary}\n\n"
      f"PLAN:\n{json.dumps(plan, indent=2)}\n\n"
      f"EXECUTION:\n{json.dumps(execution, indent=2)}\n\n"
      f"BASELINE:\n{json.dumps(baseline, indent=2)}"
    )
    stage1_parts = [{"text": stage1_prompt}]
    if video_part:
      stage1_parts.append(video_part)
    detailed_text, stage1_diag = self._call_gemini_parts(stage1_parts)
    stage_outputs["stage1_text"] = detailed_text
    stage_diagnostics["stage1"] = stage1_diag

    if not detailed_text:
      out = {
        **baseline,
        "source": "deterministic",
        "critic_chain": {
          "video": video_meta,
          "raw_model_outputs": stage_outputs,
          "raw_model_diagnostics": stage_diagnostics
        }
      }
      if not video_meta["video_input_used"]:
        out["defects"] = list(out.get("defects", [])) + [
          {
            "id": "video_not_analyzed_by_model",
            "severity_0_10": 8.8,
            "description": "Video was not attached to Gemini critic request.",
            "evidence": video_meta["video_reason"],
            "recommendation": "Ensure critic model receives video bytes/URI and rerun critique."
          }
        ]
        out["overall_severity"] = max(float(out.get("overall_severity", 0.0)), 8.8)
        out["verdict"] = "fail"
      return out

    stage2_prompt = (
      "Given the critique text below, output strict JSON with keys:\n"
      "{\n"
      '  "overall_severity": 0-10,\n'
      '  "severity_reasoning": "string",\n'
      '  "top_risks": ["string"],\n'
      '  "verdict": "pass|fail"\n'
      "}\n\n"
      "Only score risks that are supported by the requested feature scope and observed execution.\n\n"
      f"FEATURE CONTEXT:\n{context_summary}\n\n"
      f"CRITIQUE_TEXT:\n{detailed_text}"
    )
    stage2_text = None
    if self.chain_passes >= 2:
      stage2_text, stage2_diag = self._call_gemini_parts([{"text": stage2_prompt}])
      stage_diagnostics["stage2"] = stage2_diag
    stage_outputs["stage2_text"] = stage2_text
    severity_payload: Dict[str, Any] = {}
    if stage2_text:
      try:
        severity_payload = _extract_json(stage2_text)
      except Exception:
        severity_payload = {}

    stage3_prompt = (
      "You are the final aggregation agent.\n"
      "Combine detailed critique and severity assessment into strict JSON:\n"
      "{\n"
      '  "verdict": "pass|fail",\n'
      '  "overall_severity": 0-10,\n'
      '  "summary": "short paragraph",\n'
      '  "defects": [{"id":"snake_case","severity_0_10":0-10,"description":"...","evidence":"...","recommendation":"..."}],\n'
      '  "strengths": ["..."],\n'
      '  "recommendations": ["..."],\n'
      '  "score_breakdown": {"physics_consistency":0-10,"collision_stability":0-10,"motion_readability":0-10,"temporal_smoothness":0-10}\n'
      "}\n\n"
      "Requirements:\n"
      "- Be comprehensive.\n"
      "- Include specific fixing semantics.\n"
      "- If serious issues exist, do not under-report severity.\n"
      "- Only report defects that are grounded in the planned feature scope and observed execution.\n"
      "- If a requested feature was not actually exercised, represent that as an evidence gap or inconclusive coverage rather than a false defect.\n\n"
      f"FEATURE CONTEXT:\n{context_summary}\n\n"
      f"DETAILED_CRITIQUE:\n{detailed_text}\n\n"
      f"SEVERITY_JSON:\n{json.dumps(severity_payload, indent=2)}\n\n"
      f"BASELINE:\n{json.dumps(baseline, indent=2)}"
    )
    stage3_parts = [{"text": stage3_prompt}]
    if video_part:
      stage3_parts.append(video_part)
    stage3_text = None
    if self.chain_passes >= 3:
      stage3_text, stage3_diag = self._call_gemini_parts(stage3_parts)
      stage_diagnostics["stage3"] = stage3_diag
    stage_outputs["stage3_text"] = stage3_text

    if self.chain_passes < 3:
      out: CritiqueResult = {
        **baseline,
        "source": "gemini_chain_partial",
        "summary": str(detailed_text)[:1200],
        "critic_chain": {
          "video": video_meta,
          "detailed_text": detailed_text,
          "severity": severity_payload,
          "raw_model_outputs": stage_outputs,
          "raw_model_diagnostics": stage_diagnostics
        }
      }
      if severity_payload:
        out["overall_severity"] = float(severity_payload.get("overall_severity", out["overall_severity"]))
        out["verdict"] = severity_payload.get("verdict", out["verdict"])
      if not video_meta["video_input_used"]:
        out["defects"] = list(out.get("defects", [])) + [
          {
            "id": "video_not_analyzed_by_model",
            "severity_0_10": 8.8,
            "description": "Video was not attached to Gemini critic request.",
            "evidence": video_meta["video_reason"],
            "recommendation": "Ensure critic model receives video bytes/URI and rerun critique."
          }
        ]
        out["overall_severity"] = max(float(out.get("overall_severity", 0.0)), 8.8)
        out["verdict"] = "fail"
      return out

    if not stage3_text:
      out = {
        **baseline,
        "source": "deterministic",
        "critic_chain": {
          "video": video_meta,
          "detailed_text": detailed_text,
          "severity": severity_payload,
          "raw_model_outputs": stage_outputs,
          "raw_model_diagnostics": stage_diagnostics
        }
      }
      return out

    try:
      final_payload = _extract_json(stage3_text)
    except Exception:
      final_payload = {}

    merged: CritiqueResult = self._coerce_critique_shape(final_payload, baseline)
    merged["source"] = "gemini_chain_video" if video_meta["video_input_used"] else "gemini_chain_text_only"
    merged["critic_chain"] = {
      "video": video_meta,
      "detailed_text": detailed_text,
      "severity": severity_payload,
      "raw_model_outputs": stage_outputs,
      "raw_model_diagnostics": stage_diagnostics
    }
    if "score_breakdown" in final_payload:
      merged["score_breakdown"] = final_payload["score_breakdown"]

    if not video_meta["video_input_used"]:
      merged["defects"] = list(merged.get("defects", [])) + [
        {
          "id": "video_not_analyzed_by_model",
          "severity_0_10": 8.8,
          "description": "Video was not attached to Gemini critic request.",
          "evidence": video_meta["video_reason"],
          "recommendation": "Ensure critic model receives video bytes/URI and rerun critique."
        }
      ]
      merged["overall_severity"] = max(float(merged.get("overall_severity", 0.0)), 8.8)
      merged["verdict"] = "fail"

    return merged
