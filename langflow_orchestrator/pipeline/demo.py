from __future__ import annotations

from typing import Any, Dict

from .orchestrator import InMemoryStoreAdapter, LangflowOrchestrator, PipelineAdapters


class MockInspector:
  def inspect(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
    return {
      "title": "Demo App",
      "url": normalized["url"],
      "headings": ["Demo App"],
      "buttons": ["Run"],
      "buttonSelectors": ["#go"],
      "textTargets": ["#state"],
      "links": [],
      "hasForms": False,
      "inputs": []
    }


class MockPlanner:
  def plan(self, normalized: Dict[str, Any], inspection: Dict[str, Any]) -> Dict[str, Any]:
    return {
      "summary": f"Validate objective: {normalized['objective']}",
      "confirmMessage": "Confirm generated procedure before execution.",
      "steps": [
        {"action": "goto", "target": normalized["url"]},
        {"action": "assertVisible", "target": "text=Demo App"},
        {"action": "captureText", "target": "#state", "value": "beforeState"},
        {"action": "click", "target": "#go"},
        {"action": "assertChanged", "target": "#state", "value": "beforeState"},
        {"action": "screenshot", "target": "fullPage"}
      ],
      "notes": normalized.get("notes", "")
    }


class MockCodex:
  def plan(self, normalized: Dict[str, Any], procedure: Dict[str, Any], inspection: Dict[str, Any]) -> Dict[str, Any]:
    return {
      "status": "ok",
      "pass": True,
      "reason": "Mock Codex planning completed",
      "stdout": "{\"suggested_steps\": 6}",
      "stderr": ""
    }


class MockRunner:
  def execute(
    self,
    normalized: Dict[str, Any],
    procedure: Dict[str, Any],
    parser: Dict[str, Any],
    executor: Dict[str, Any]
  ) -> Dict[str, Any]:
    return {
      "status": "pass",
      "summary": "Procedure executed successfully.",
      "steps": [
        {"index": step["index"], "action": step["action"], "target": step.get("target"), "status": "pass", "note": "ok"}
        for step in parser.get("normalizedSteps", [])
      ],
      "artifacts": [
        {"type": "parser", "path": "db/agentic_artifacts/request_parser.json"},
        {"type": "executor", "path": "db/agentic_artifacts/playwright_executor.generated.js"},
        {"type": "video", "path": "db/agentic_artifacts/run.webm"}
      ],
      "videoPath": "db/agentic_artifacts/run.webm"
    }


def run_demo() -> Dict[str, Any]:
  adapters = PipelineAdapters(
    inspector=MockInspector(),
    planner=MockPlanner(),
    codex=MockCodex(),
    runner=MockRunner(),
    store=InMemoryStoreAdapter()
  )
  events = []
  orchestrator = LangflowOrchestrator(adapters=adapters, event_sink=lambda msg: events.append(msg))

  result = orchestrator.run(
    {
      "projectName": "Jungle",
      "url": "http://127.0.0.1:3000",
      "task": "Click run and verify state changes from idle to pass",
      "notes": "Demo run",
      "skipCodex": False
    }
  )
  result["events"] = events
  return result


if __name__ == "__main__":
  import json

  print(json.dumps(run_demo(), indent=2))

