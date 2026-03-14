from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class AgenticInput(TypedDict, total=False):
  feature_goal: str
  environment_context: str
  target_url: str
  constraints: str
  max_retries: int
  severity_threshold: float
  project_root: str


class EnvironmentSnapshot(TypedDict, total=False):
  project_root: str
  target_url: str
  feature_goal: str
  environment_context: str
  constraints: str
  scripts: Dict[str, str]
  key_files: Dict[str, str]
  file_inventory: List[str]
  detected_stack: List[str]


class ExecutionPlan(TypedDict, total=False):
  objective: str
  rationale: str
  app_bootstrap: Dict[str, Any]
  steps: List[Dict[str, Any]]
  assertions: List[str]
  success_criteria: List[str]


class ExecutionResult(TypedDict, total=False):
  status: str
  summary: str
  steps: List[Dict[str, Any]]
  app_runtime: Dict[str, Any]
  video_path: Optional[str]
  artifacts: List[str]
  generated_code_path: Optional[str]
  parser_path: Optional[str]
  stdout: str
  stderr: str


class CritiqueIssue(TypedDict, total=False):
  id: str
  severity_0_10: float
  description: str
  evidence: str
  recommendation: str


class CritiqueResult(TypedDict, total=False):
  verdict: str
  overall_severity: float
  summary: str
  defects: List[CritiqueIssue]
  strengths: List[str]
  recommendations: List[str]
  source: str


class OrchestrationOutput(TypedDict, total=False):
  plan: ExecutionPlan
  execution: ExecutionResult
  critique: CritiqueResult
  final_verdict: str
  escalated: bool
  severity_threshold: float
  pass_condition: str
