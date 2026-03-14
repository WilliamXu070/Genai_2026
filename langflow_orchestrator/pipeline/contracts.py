from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class OrchestrationInput(TypedDict, total=False):
  projectName: str
  url: str
  task: str
  objective: str
  notes: str
  additions: str
  forestId: str
  skipCodex: bool
  codexTimeoutMs: int


class NormalizedInput(TypedDict):
  projectName: str
  url: str
  task: str
  objective: str
  notes: str
  additions: str
  forestId: Optional[str]
  skipCodex: bool
  codexTimeoutMs: int


class Inspection(TypedDict, total=False):
  title: str
  url: str
  headings: List[str]
  buttons: List[str]
  buttonSelectors: List[str]
  textTargets: List[str]
  links: List[str]
  hasForms: bool
  inputs: List[str]


class ProcedureStep(TypedDict, total=False):
  action: str
  target: str
  value: str
  assert_: str


class Procedure(TypedDict, total=False):
  summary: str
  confirmMessage: str
  steps: List[Dict[str, Any]]
  notes: str


class RequestParserStep(TypedDict, total=False):
  index: int
  action: str
  target: Optional[str]
  value: Optional[str]
  assert_: Optional[str]


class RequestParser(TypedDict):
  parserVersion: str
  normalizedSteps: List[Dict[str, Any]]


class Artifact(TypedDict):
  type: str
  path: str


class PlaywrightResult(TypedDict, total=False):
  status: str
  summary: str
  steps: List[Dict[str, Any]]
  artifacts: List[Artifact]
  videoPath: Optional[str]


class CodexResult(TypedDict, total=False):
  status: str
  pass_: bool
  reason: str
  stdout: str
  stderr: str


class PersistedRun(TypedDict, total=False):
  runId: str
  forestId: str
  treeId: str
  status: str
  summary: str
  steps: List[Dict[str, Any]]
  artifacts: List[Artifact]
  videoPath: Optional[str]
  createdAt: str


class OrchestrationResult(TypedDict, total=False):
  forestId: str
  treeId: str
  objective: str
  procedure: Procedure
  parser: RequestParser
  run: PersistedRun
  codex: CodexResult
  executor: Dict[str, Any]

