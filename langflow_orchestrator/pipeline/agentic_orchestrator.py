from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from .agentic_contracts import AgenticInput, OrchestrationOutput
from .agentic_tools import build_environment_snapshot, ensure_target_app, execute_playwright_plan
from .env_bootstrap import load_project_env
from .gemini_critic_agent import GeminiCriticAgent
from .openai_environment_agent import OpenAIEnvironmentAgent
from .openai_execution_agent import OpenAIExecutionAgent


class AgenticLangflowOrchestrator:
  def __init__(self, project_root: str):
    self.project_root = str(Path(project_root).resolve())
    self.loaded_env = load_project_env(self.project_root)
    self.environment_agent = OpenAIEnvironmentAgent()
    self.openai_agent = OpenAIExecutionAgent()
    self.critic_agent = GeminiCriticAgent()

  def run(self, payload: AgenticInput) -> OrchestrationOutput:
    feature_goal = payload.get("feature_goal") or "Validate feature behavior"
    target_url = payload.get("target_url") or ""

    severity_threshold = float(payload.get("severity_threshold", 8.0))
    snapshot = build_environment_snapshot(
      project_root=payload.get("project_root", self.project_root),
      feature_goal=feature_goal,
      target_url=target_url,
      environment_context=payload.get("environment_context", ""),
      constraints=payload.get("constraints", "")
    )

    environment_plan = self.environment_agent.plan(snapshot)
    # initial planning for bootstrap hints; execution plan is generated after URL resolution
    seed_plan = {
      "objective": feature_goal,
      "rationale": "Seed plan for environment bootstrap.",
      "app_bootstrap": environment_plan.get("app_bootstrap", {}),
      "steps": [],
      "assertions": [],
      "success_criteria": []
    }
    server_session = ensure_target_app(self.project_root, target_url, seed_plan, environment_plan)
    if not server_session.ready:
      execution = {
        "status": "fail",
        "summary": f"Target app not ready: {server_session.status}. {server_session.error_message}",
        "steps": [],
        "app_runtime": server_session.to_dict(),
        "video_path": None,
        "artifacts": [server_session.log_path] if server_session.log_path else [],
        "generated_code_path": None,
        "parser_path": None,
        "stdout": "",
        "stderr": server_session.error_message
      }
      plan = {
        "objective": feature_goal,
        "rationale": environment_plan.get("summary", "Environment bootstrap failed."),
        "app_bootstrap": environment_plan.get("app_bootstrap", {}),
        "steps": [],
        "assertions": [],
        "success_criteria": []
      }
    else:
      resolved_url = server_session.target_url
      snapshot_with_url = {**snapshot, "target_url": resolved_url}
      plan = self.openai_agent.plan(snapshot_with_url)
      try:
        execution = execute_playwright_plan(self.project_root, plan, resolved_url)
      finally:
        if server_session.started_by_orchestrator:
          server_session.stop()
      execution["app_runtime"] = server_session.to_dict()
    critique = self.critic_agent.critique(plan, execution)

    overall_severity = float(critique.get("overall_severity", 0.0))
    escalated = overall_severity > severity_threshold
    final_verdict = "fail" if escalated or execution.get("status") != "pass" else "pass"

    output: OrchestrationOutput = {
      "plan": plan,
      "execution": execution,
      "critique": critique,
      "final_verdict": final_verdict,
      "escalated": escalated,
      "severity_threshold": severity_threshold,
      "pass_condition": f"execution.status == pass AND critique.overall_severity <= {severity_threshold}"
    }
    self._persist(output)
    return output

  def _persist(self, output: Dict[str, Any]) -> None:
    db_dir = Path(self.project_root) / "db" / "langflow_agentic_runs"
    db_dir.mkdir(parents=True, exist_ok=True)
    out_path = db_dir / f"orchestration_{__import__('time').time_ns()}.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
