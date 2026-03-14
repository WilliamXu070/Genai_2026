# Langflow Orchestrator Package

This folder contains a full orchestration pipeline design and code scaffold for implementing the Jungle flow in Langflow.

## Goal

Replicate Jungle's orchestration behavior:

1. Accept task + URL input
2. Inspect website context
3. Generate test procedure steps
4. Normalize into request parser format
5. Generate executor program metadata
6. Optionally call Codex/MCP planning
7. Execute Playwright procedure
8. Persist run and artifacts
9. Return final orchestration result

## Folder Layout

- `pipeline/contracts.py`: typed data contracts shared across all nodes.
- `pipeline/stages.py`: pure stage logic (normalization, fallback planning, parser build, executor build, artifact normalization).
- `pipeline/orchestrator.py`: end-to-end orchestration loop with pluggable adapters.
- `flow_blueprint.yaml`: Langflow-ready node + edge blueprint and node responsibilities.
- `examples/sample_payload.json`: sample orchestration request payload.

## Pipeline Stages

1. `normalize_input`
- Validates required fields.
- Derives objective from `task` if objective is missing.

2. `inspect_website`
- Collects page context (title, headings, button selectors, text targets, forms/inputs).
- Implemented via adapter so you can wire Playwright/Browserbase/your inspection API.

3. `generate_procedure`
- Calls planner adapter (LLM) for strict JSON:
  - `summary`
  - `confirmMessage`
  - `steps[]`
  - `notes`

4. `fallback_if_invalid`
- If planner output is invalid/empty, creates deterministic test plan.

5. `build_request_parser`
- Produces parser shape:
  - `parserVersion`
  - `normalizedSteps[]` with indexed actions/targets/values/asserts.

6. `generate_executor`
- Generates executor artifact metadata that can drive Playwright runner services.

7. `optional_codex_mcp`
- Optional branch controlled by `skipCodex`.
- Captures transcript text even on failure.

8. `run_playwright`
- Calls runner adapter and returns:
  - status, summary, steps, artifacts, videoPath.

9. `persist_run`
- Store adapter writes run/tree/forest and artifact metadata.

10. `final_result`
- Returns merged payload with procedure, parser, and run summary.

## Adapter Model

`orchestrator.py` uses adapter interfaces so Langflow nodes can call external services while stage logic remains stable.

- `inspector`: site inspection.
- `planner`: procedure generation from inspection + objective.
- `codex`: optional Codex/MCP planning.
- `runner`: Playwright execution.
- `store`: persistence and IDs.
- `event_sink`: event streaming callback.

## How To Use In Langflow

1. Add Python function/custom component nodes that call each stage in `pipeline/stages.py`.
2. Wire external tool/API nodes for inspector/planner/codex/runner/store.
3. Follow `flow_blueprint.yaml` for exact node ordering and branch behavior.
4. Keep procedure JSON schema strict to avoid execution ambiguity.

## Environment Expectations

- `PLAYWRIGHT_RUNNER_URL`: endpoint used by your runner adapter.
- `PLANNER_URL` or model credentials (OpenAI/Gemini) used by planner adapter.
- Optional Codex/MCP CLI or service endpoint for codex adapter.

