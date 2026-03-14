# Testing Loop Agent Rules

Use this folder's tool as the default post-feature validation loop.

## Mandatory Tool

- Tool name: `orchestrate_testing`
- Command:
  - `node "Testing/Testing Loop/orchestrate_testing.js" --input-file "<path-to-json>"`

Run this tool every time a new feature is built or modified.

## Pre-Run Requirement

Before calling the tool, ensure the feature environment is ready for testing:

1. Dependencies installed for the target app.
2. Required services/processes are available.
3. `target_url` is correct for the feature under test.

If the app is not already up, include enough context in payload so the orchestration can bootstrap/start it.

## Required Input Schema

The JSON payload passed to `orchestrate_testing` must follow:

```json
{
  "feature_goal": "string (optional)",
  "target_url": "string (required)",
  "environment_context": "string (optional)",
  "constraints": "string (optional)",
  "severity_threshold": "number (optional, default 8.0)",
  "max_retries": "number (optional)",
  "project_root": "string (optional)"
}
```

## Autonomous Loop Policy

Codex must continue this sequence until testing passes:

1. Implement or modify feature code.
2. Run `orchestrate_testing`.
3. Read `fix_packet` and final verdict from tool output.
4. Apply fixes.
5. Re-run `orchestrate_testing`.
6. Stop only when:
   - `finalVerdict == "pass"`
   - `executionStatus == "pass"`
   - `escalated == false`

If max iterations are reached, report the remaining top defects and artifact paths.

Use `--skip-codex-fix` if you want test-only execution without automatic nested `codex exec`.

## Example Invocation

```powershell
node "Testing/Testing Loop/orchestrate_testing.js" `
  --input-json "{\"feature_goal\":\"Validate new checkout flow\",\"target_url\":\"http://127.0.0.1:8088\",\"environment_context\":\"Local feature branch\",\"constraints\":\"No destructive actions\",\"severity_threshold\":8,\"max_retries\":2,\"project_root\":\"C:\\Users\\William\\Desktop\\Projects\\Genai_2026\"}"
```
