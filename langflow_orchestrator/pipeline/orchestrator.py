from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Protocol

from .contracts import (
  CodexResult,
  Inspection,
  NormalizedInput,
  OrchestrationInput,
  OrchestrationResult,
  PersistedRun,
  PlaywrightResult,
  Procedure
)
from .stages import build_request_parser, choose_procedure, generate_executor, normalize_artifacts, normalize_input


def _utc_now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


class InspectorAdapter(Protocol):
  def inspect(self, normalized: NormalizedInput) -> Inspection:
    ...


class PlannerAdapter(Protocol):
  def plan(self, normalized: NormalizedInput, inspection: Inspection) -> Dict[str, Any]:
    ...


class CodexAdapter(Protocol):
  def plan(self, normalized: NormalizedInput, procedure: Procedure, inspection: Inspection) -> CodexResult:
    ...


class RunnerAdapter(Protocol):
  def execute(
    self,
    normalized: NormalizedInput,
    procedure: Procedure,
    parser: Dict[str, Any],
    executor: Dict[str, Any]
  ) -> PlaywrightResult:
    ...


class StoreAdapter(Protocol):
  def persist(
    self,
    normalized: NormalizedInput,
    procedure: Procedure,
    parser: Dict[str, Any],
    executor: Dict[str, Any],
    codex: CodexResult,
    run_result: PlaywrightResult
  ) -> PersistedRun:
    ...


@dataclass
class PipelineAdapters:
  inspector: InspectorAdapter
  planner: PlannerAdapter
  runner: RunnerAdapter
  store: StoreAdapter
  codex: Optional[CodexAdapter] = None


class LangflowOrchestrator:
  def __init__(self, adapters: PipelineAdapters, event_sink: Optional[Callable[[str], None]] = None):
    self.adapters = adapters
    self.event_sink = event_sink

  def emit(self, message: str) -> None:
    if self.event_sink:
      self.event_sink(message)

  def run(self, payload: OrchestrationInput) -> OrchestrationResult:
    self.emit("Starting orchestration loop")
    normalized = normalize_input(payload)

    self.emit("Inspecting target website")
    inspection = self.adapters.inspector.inspect(normalized)

    self.emit("Generating procedure from task/objective")
    plan = self.adapters.planner.plan(normalized, inspection)
    procedure = choose_procedure(plan, inspection, normalized)

    self.emit("Building request parser")
    parser = build_request_parser(procedure)

    self.emit("Generating executor metadata")
    executor = generate_executor(parser)

    codex: CodexResult = {
      "status": "skipped",
      "pass": False,
      "reason": "Codex branch skipped",
      "stdout": "",
      "stderr": ""
    }
    if not normalized["skipCodex"] and self.adapters.codex:
      self.emit("Calling Codex/MCP planning branch")
      codex = self.adapters.codex.plan(normalized, procedure, inspection)

    self.emit("Executing Playwright runner")
    run_result = self.adapters.runner.execute(normalized, procedure, parser, executor)
    run_result["artifacts"] = normalize_artifacts(run_result.get("artifacts", []))

    self.emit("Persisting run and artifacts")
    persisted = self.adapters.store.persist(normalized, procedure, parser, executor, codex, run_result)

    self.emit(f"Orchestration complete: {persisted.get('status', run_result.get('status', 'unknown'))}")
    return {
      "forestId": persisted.get("forestId", ""),
      "treeId": persisted.get("treeId", ""),
      "objective": normalized["objective"],
      "procedure": procedure,
      "parser": parser,
      "executor": executor,
      "codex": codex,
      "run": persisted
    }


class InMemoryStoreAdapter:
  def __init__(self) -> None:
    self.counter = 0
    self.forest_counter = 0
    self.tree_counter = 0

  def persist(
    self,
    normalized: NormalizedInput,
    procedure: Procedure,
    parser: Dict[str, Any],
    executor: Dict[str, Any],
    codex: CodexResult,
    run_result: PlaywrightResult
  ) -> PersistedRun:
    self.counter += 1
    if not normalized.get("forestId"):
      self.forest_counter += 1
    self.tree_counter += 1

    forest_id = normalized.get("forestId") or f"forest_{self.forest_counter}"
    tree_id = f"tree_{self.tree_counter}"
    run_id = f"agentic_run_{self.counter}"

    artifacts = (run_result.get("artifacts") or []) + [
      {"type": "executor", "path": executor.get("name", "playwright_executor.generated.js")},
      {"type": "codex_mcp", "path": f"inline://{codex.get('status', 'skipped')}"}
    ]

    return {
      "runId": run_id,
      "forestId": forest_id,
      "treeId": tree_id,
      "status": run_result.get("status", "fail"),
      "summary": run_result.get("summary", "No summary"),
      "steps": run_result.get("steps", []),
      "artifacts": artifacts,
      "videoPath": run_result.get("videoPath"),
      "createdAt": _utc_now_iso()
    }

