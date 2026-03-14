from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib import error, request

from .agentic_contracts import EnvironmentSnapshot, ExecutionPlan, ExecutionResult


def _read_text(path: Path, max_chars: int = 4000) -> str:
  if not path.exists():
    return ""
  try:
    text = path.read_text(encoding="utf-8", errors="ignore")
    return text[:max_chars]
  except Exception:
    return ""


def build_environment_snapshot(
  project_root: str,
  feature_goal: str,
  target_url: str,
  environment_context: str = "",
  constraints: str = ""
) -> EnvironmentSnapshot:
  root = Path(project_root).resolve()
  package_json_path = root / "package.json"
  package_json = {}
  if package_json_path.exists():
    try:
      package_json = json.loads(package_json_path.read_text(encoding="utf-8"))
    except Exception:
      package_json = {}

  scripts = package_json.get("scripts", {}) if isinstance(package_json, dict) else {}
  file_inventory = []
  for p in root.rglob("*"):
    if p.is_file():
      rel = str(p.relative_to(root)).replace("\\", "/")
      if "node_modules/" in rel or rel.startswith(".git/"):
        continue
      file_inventory.append(rel)
      if len(file_inventory) >= 250:
        break

  key_files = {
    "package.json": _read_text(root / "package.json"),
    "src/main.js": _read_text(root / "src" / "main.js"),
    "src/runtime/agentic_loop.js": _read_text(root / "src" / "runtime" / "agentic_loop.js"),
    "src/renderer/index.html": _read_text(root / "src" / "renderer" / "index.html")
  }

  detected_stack = []
  if (root / "package.json").exists():
    detected_stack.append("node")
  if (root / "src" / "main.js").exists():
    detected_stack.append("electron")
  if any("playwright" in line for line in key_files.get("package.json", "").splitlines()):
    detected_stack.append("playwright")

  return {
    "project_root": str(root),
    "target_url": target_url,
    "feature_goal": feature_goal,
    "environment_context": environment_context,
    "constraints": constraints,
    "scripts": scripts,
    "key_files": key_files,
    "file_inventory": file_inventory,
    "detected_stack": detected_stack
  }


def fallback_execution_plan(snapshot: EnvironmentSnapshot) -> ExecutionPlan:
  target_url = snapshot.get("target_url", "")
  return {
    "objective": snapshot.get("feature_goal", "Validate target feature behavior"),
    "rationale": "Fallback deterministic plan based on environment snapshot.",
    "app_bootstrap": {
      "required": False,
      "reason": "Fallback plan assumes app is already available at target URL.",
      "workspace": ".",
      "files": [],
      "install_command": "",
      "start_command": "",
      "startup_timeout_ms": 60000
    },
    "steps": [
      {"action": "goto", "target": target_url},
      {"action": "assertVisible", "target": "body"},
      {"action": "wait", "target": "time", "value": 10000},
      {"action": "scrollPage", "target": "down"},
      {"action": "screenshot", "target": "fullPage"}
    ],
    "assertions": ["Page renders", "No fatal runtime errors during observation window"],
    "success_criteria": ["Execution completes", "Video artifact exists"]
  }


class LocalServerSession:
  def __init__(
    self,
    status: str,
    target_url: str,
    ready: bool,
    started_by_orchestrator: bool,
    workspace: str,
    start_command: str,
    install_command: str,
    log_path: str | None = None,
    pid: int | None = None,
    error_message: str = ""
  ):
    self.status = status
    self.target_url = target_url
    self.ready = ready
    self.started_by_orchestrator = started_by_orchestrator
    self.workspace = workspace
    self.start_command = start_command
    self.install_command = install_command
    self.log_path = log_path
    self.pid = pid
    self.error_message = error_message
    self._process: subprocess.Popen | None = None

  def attach_process(self, process: subprocess.Popen) -> None:
    self._process = process
    self.pid = process.pid

  def stop(self) -> None:
    if not self._process:
      return
    if self._process.poll() is not None:
      return
    try:
      self._process.terminate()
      self._process.wait(timeout=10)
    except Exception:
      try:
        self._process.kill()
      except Exception:
        pass

  def to_dict(self) -> Dict[str, Any]:
    return {
      "status": self.status,
      "target_url": self.target_url,
      "ready": self.ready,
      "started_by_orchestrator": self.started_by_orchestrator,
      "workspace": self.workspace,
      "start_command": self.start_command,
      "install_command": self.install_command,
      "log_path": self.log_path,
      "pid": self.pid,
      "error_message": self.error_message
    }


def _is_url_reachable(url: str, timeout_sec: float = 2.0) -> bool:
  if not url:
    return False
  req = request.Request(url, method="GET")
  try:
    with request.urlopen(req, timeout=timeout_sec) as resp:
      return int(getattr(resp, "status", 200)) < 500
  except error.HTTPError as exc:
    return 200 <= int(exc.code) < 500
  except Exception:
    return False


def _candidate_urls(requested_url: str, env_plan: Dict[str, Any]) -> List[str]:
  candidates: List[str] = []
  if requested_url:
    candidates.append(requested_url)
  resolved = str(env_plan.get("resolved_target_url", "") or "").strip()
  if resolved:
    candidates.append(resolved)
  model_candidates = env_plan.get("candidate_urls", [])
  if isinstance(model_candidates, list):
    candidates.extend([str(x).strip() for x in model_candidates if str(x).strip()])
  defaults = [
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8088",
    "http://127.0.0.1:8093"
  ]
  candidates.extend(defaults)
  # stable de-dup
  out: List[str] = []
  seen = set()
  for c in candidates:
    if c in seen:
      continue
    seen.add(c)
    out.append(c)
  return out


def _write_bootstrap_files(root: Path, workspace: Path, files: List[Dict[str, Any]]) -> None:
  for f in files:
    rel = str(f.get("path", "")).strip()
    if not rel:
      continue
    content = str(f.get("content", ""))
    target = (workspace / rel).resolve()
    # Do not allow writes outside repository root.
    if root not in target.parents and target != root:
      continue
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def _resolve_workspace(root: Path, bootstrap: Dict[str, Any]) -> Path:
  workspace_rel = str(bootstrap.get("workspace", ".") or ".").strip()
  workspace = (root / workspace_rel).resolve()
  if not workspace.exists():
    workspace.mkdir(parents=True, exist_ok=True)
  return workspace


def _default_start_command(workspace: Path) -> str:
  package_json_path = workspace / "package.json"
  if not package_json_path.exists():
    return ""
  try:
    pkg = json.loads(package_json_path.read_text(encoding="utf-8"))
  except Exception:
    return ""
  scripts = pkg.get("scripts", {}) if isinstance(pkg, dict) else {}
  if "dev" in scripts:
    return "npm run dev"
  if "start" in scripts:
    return "npm start"
  return ""


def ensure_target_app(
  project_root: str,
  target_url: str,
  plan: ExecutionPlan,
  environment_plan: Dict[str, Any] | None = None
) -> LocalServerSession:
  root = Path(project_root).resolve()
  env_plan = environment_plan or {}
  bootstrap = {}
  if isinstance(env_plan.get("app_bootstrap"), dict):
    bootstrap = dict(env_plan.get("app_bootstrap") or {})
  if not bootstrap and isinstance(plan, dict) and isinstance(plan.get("app_bootstrap"), dict):
    bootstrap = dict(plan.get("app_bootstrap") or {})
  workspace = _resolve_workspace(root, bootstrap)
  candidates = _candidate_urls(target_url, env_plan)

  for url in candidates:
    if _is_url_reachable(url):
      return LocalServerSession(
        status="already_running",
        target_url=url,
        ready=True,
        started_by_orchestrator=False,
        workspace=str(workspace),
        start_command="",
        install_command=""
      )

  effective_target = candidates[0] if candidates else ""

  files = bootstrap.get("files", [])
  if isinstance(files, list) and files:
    _write_bootstrap_files(root, workspace, files)

  install_command = str(bootstrap.get("install_command", "") or "").strip()
  if install_command:
    install_proc = subprocess.run(
      install_command,
      cwd=str(workspace),
      shell=True,
      capture_output=True,
      text=True
    )
    if install_proc.returncode != 0:
      return LocalServerSession(
        status="install_failed",
        target_url=target_url,
        ready=False,
        started_by_orchestrator=False,
        workspace=str(workspace),
        start_command="",
        install_command=install_command,
        error_message=install_proc.stderr.strip() or install_proc.stdout.strip()
      )

  start_command = str(bootstrap.get("start_command", "") or "").strip() or _default_start_command(workspace)
  if not start_command:
    # Last-ditch fallback for a static HTML folder.
    if (workspace / "index.html").exists():
      start_command = "npx http-server -p 8093 -c-1 ."
      effective_target = effective_target or "http://127.0.0.1:8093"
      candidates = _candidate_urls(effective_target, env_plan)
    else:
      return LocalServerSession(
        status="missing_start_command",
        target_url=effective_target,
        ready=False,
        started_by_orchestrator=False,
        workspace=str(workspace),
        start_command="",
        install_command=install_command,
        error_message="No start_command provided and no package script (dev/start) detected."
      )

  if not effective_target:
    effective_target = "http://127.0.0.1:3000"
    candidates = _candidate_urls(effective_target, env_plan)

  runs_dir = root / "db" / "langflow_agentic_runs"
  runs_dir.mkdir(parents=True, exist_ok=True)
  log_path = runs_dir / f"server_bootstrap_{int(time.time() * 1000)}.log"
  with log_path.open("w", encoding="utf-8") as _:
    pass
  wrapped_start_command = f'{start_command} >> "{str(log_path)}" 2>&1'
  try:
    child = subprocess.Popen(
      wrapped_start_command,
      cwd=str(workspace),
      shell=True,
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      text=True
    )
  except Exception as exc:
    return LocalServerSession(
      status="start_failed",
      target_url=effective_target,
      ready=False,
      started_by_orchestrator=False,
      workspace=str(workspace),
      start_command=start_command,
      install_command=install_command,
      log_path=str(log_path),
      error_message=str(exc)
    )

  timeout_ms = int(bootstrap.get("startup_timeout_ms", 60000) or 60000)
  deadline = time.time() + (timeout_ms / 1000.0)
  while time.time() < deadline:
    ready_url = next((u for u in candidates if _is_url_reachable(u)), "")
    if ready_url:
      session = LocalServerSession(
        status="started",
        target_url=ready_url,
        ready=True,
        started_by_orchestrator=True,
        workspace=str(workspace),
        start_command=start_command,
        install_command=install_command,
        log_path=str(log_path)
      )
      session.attach_process(child)
      return session
    if child.poll() is not None:
      return LocalServerSession(
        status="start_exited_early",
        target_url=effective_target,
        ready=False,
        started_by_orchestrator=False,
        workspace=str(workspace),
        start_command=start_command,
        install_command=install_command,
        log_path=str(log_path),
        error_message=f"Process exited with code {child.returncode}"
      )
    time.sleep(1.0)

  session = LocalServerSession(
    status="startup_timeout",
    target_url=effective_target,
    ready=False,
    started_by_orchestrator=True,
    workspace=str(workspace),
    start_command=start_command,
    install_command=install_command,
    log_path=str(log_path),
    error_message=f"Server did not become reachable within {timeout_ms}ms"
  )
  session.attach_process(child)
  session.stop()
  return session


def _plan_to_executor_code(plan: ExecutionPlan) -> str:
  code_lines: List[str] = []
  for step in plan.get("steps", []):
    action = str(step.get("action", ""))
    target = json.dumps(step.get("target", "body"))
    value = json.dumps(step.get("value", ""))
    if action == "goto":
      code_lines.append(f"await page.goto({target}, {{ waitUntil: 'domcontentloaded', timeout: 30000 }});")
    elif action == "assertVisible":
      code_lines.append(f"await page.locator({target}).first().waitFor({{ state: 'visible', timeout: 10000 }});")
    elif action == "captureText":
      code_lines.append(f"stateStore[{value}] = await page.locator({target}).first().innerText({{ timeout: 10000 }});")
    elif action == "click":
      code_lines.append(f"await page.locator({target}).first().click({{ timeout: 10000 }});")
    elif action == "fill":
      code_lines.append(f"await page.locator({target}).first().fill({value}, {{ timeout: 10000 }});")
    elif action == "assertChanged":
      code_lines.append(
        "await page.waitForFunction(({ selector, before }) => { const el = document.querySelector(selector); if (!el) return false; const current = (el.innerText || el.textContent || '').trim(); return current !== before; }, "
        + f"{{ selector: {target}, before: (stateStore[{value}] || '') }}, {{ timeout: 10000 }});"
      )
    elif action == "scrollPage":
      code_lines.append(
        "await page.evaluate(async () => { const maxY = document.documentElement.scrollHeight - window.innerHeight; let y = 0; const stride = Math.max(120, Math.floor(window.innerHeight * 0.75)); while (y < maxY) { y = Math.min(maxY, y + stride); window.scrollTo(0, y); await new Promise((resolve) => setTimeout(resolve, 250)); } });"
      )
    elif action == "wait":
      ms = int(step.get("value", 10000))
      code_lines.append(f"await page.waitForTimeout({ms});")
    elif action == "screenshot":
      code_lines.append("await page.screenshot({ path: path.join(artifactsDir, `step_${Date.now()}.png`), fullPage: true });")
    else:
      code_lines.append(f"// unsupported action preserved: {action}")

  return "\n  ".join(code_lines)


def execute_playwright_plan(project_root: str, plan: ExecutionPlan, target_url: str) -> ExecutionResult:
  root = Path(project_root).resolve()
  artifacts_dir = root / "db" / "langflow_agentic_runs" / f"run_{os.getpid()}_{int(__import__('time').time()*1000)}"
  artifacts_dir.mkdir(parents=True, exist_ok=True)
  parser_path = artifacts_dir / "request_parser.json"
  code_path = artifacts_dir / "playwright_executor.generated.js"

  parser_payload = {
    "parserVersion": "0.1.0",
    "normalizedSteps": [
      {
        "index": i,
        "action": step.get("action"),
        "target": step.get("target"),
        "value": step.get("value"),
        "assert": step.get("assert")
      }
      for i, step in enumerate(plan.get("steps", []))
    ]
  }
  parser_path.write_text(json.dumps(parser_payload, indent=2), encoding="utf-8")

  body = _plan_to_executor_code(plan)
  executor_source = (
    "const fs = require('node:fs');\n"
    "const path = require('node:path');\n"
    "const { chromium } = require('playwright');\n"
    "(async () => {\n"
    f"  const baseUrl = {json.dumps(target_url)};\n"
    f"  const artifactsDir = {json.dumps(str(artifacts_dir))};\n"
    "  const browser = await chromium.launch({ headless: true });\n"
    "  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });\n"
    "  const page = await context.newPage();\n"
    "  const stateStore = {};\n"
    "  const stepResults = [];\n"
    "  let status = 'pass';\n"
    "  let summary = 'Procedure executed successfully.';\n"
    "  try {\n"
    f"  {body}\n"
    "  } catch (error) {\n"
    "    status = 'fail';\n"
    "    summary = error.message;\n"
    "  }\n"
    "  await page.screenshot({ path: path.join(artifactsDir, `final_${Date.now()}.png`), fullPage: true });\n"
    "  await context.close();\n"
    "  await browser.close();\n"
    "  const artifacts = fs.readdirSync(artifactsDir).map((n) => path.join(artifactsDir, n));\n"
    "  const video = artifacts.find((a) => a.endsWith('.webm')) || null;\n"
    "  const out = { status, summary, steps: stepResults, video_path: video, artifacts };\n"
    "  console.log(JSON.stringify(out));\n"
    "})().catch((error) => { console.error(error); process.exit(1); });\n"
  )
  code_path.write_text(executor_source, encoding="utf-8")

  proc = subprocess.run(
    ["node", str(code_path)],
    cwd=str(root),
    capture_output=True,
    text=True
  )

  stdout = proc.stdout.strip()
  stderr = proc.stderr.strip()
  result = {
    "status": "fail",
    "summary": "Execution failed before result parse",
    "steps": [],
    "video_path": None,
    "artifacts": [str(p) for p in artifacts_dir.glob("*")],
    "generated_code_path": str(code_path),
    "parser_path": str(parser_path),
    "stdout": stdout,
    "stderr": stderr
  }

  if proc.returncode == 0 and stdout:
    try:
      parsed = json.loads(stdout.splitlines()[-1])
      result.update(
        {
          "status": parsed.get("status", "fail"),
          "summary": parsed.get("summary", ""),
          "steps": parsed.get("steps", []),
          "video_path": parsed.get("video_path"),
          "artifacts": parsed.get("artifacts", result["artifacts"])
        }
      )
    except Exception:
      result["summary"] = "Execution completed but output parse failed"
  else:
    result["summary"] = stderr or stdout or result["summary"]

  return result
