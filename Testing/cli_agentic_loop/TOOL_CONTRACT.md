# Codex <-> Langflow Tool Contract

This defines the schema between Codex loop runner and `Testing/tools/jungle_tool_bridge.js --mode langflow-cli`.

## Tool Request Schema

Top-level:

```json
{
  "requestId": "string (required)",
  "type": "jungle:start-run",
  "payload": {
    "objective": "string (required if task/scenarioName missing)",
    "task": "string (optional)",
    "scenarioName": "string (optional)",
    "url": "string (required, target localhost/app URL)",
    "projectRoot": "string (optional, absolute preferred)",
    "environmentContext": "string (optional)",
    "constraints": "string (optional)",
    "severityThreshold": "number 0..10 (optional, default 8)",
    "maxRetries": "integer 0..10 (optional, default 2)"
  }
}
```

Rules:
- `type` must be `jungle:start-run`.
- `payload.url` must be present.
- At least one of `payload.objective`, `payload.task`, `payload.scenarioName` must be present.
- `severityThreshold` is clamped/validated to `0..10`.
- `maxRetries` is clamped/validated to `0..10`.

## Orchestrator Payload Mapping

Bridge converts tool request payload to Python orchestrator payload:

```json
{
  "feature_goal": "payload.objective || payload.task || payload.scenarioName",
  "environment_context": "payload.environmentContext || default",
  "target_url": "payload.url",
  "constraints": "payload.constraints || default",
  "severity_threshold": "payload.severityThreshold || 8.0",
  "max_retries": "payload.maxRetries || 2",
  "project_root": "payload.projectRoot || repoRoot"
}
```

## Required Orchestrator Response Schema

```json
{
  "plan": {},
  "execution": {},
  "critique": {},
  "final_verdict": "pass|fail"
}
```

Bridge rejects malformed responses before returning to Codex loop.

## Minimal Valid Request Example

```json
{
  "requestId": "cli_loop_1",
  "type": "jungle:start-run",
  "payload": {
    "objective": "Test generated app feature",
    "url": "http://127.0.0.1:8088",
    "severityThreshold": 8,
    "maxRetries": 2
  }
}
```

## CLI Example

```powershell
node Testing/tools/jungle_tool_bridge.js `
  --mode langflow-cli `
  --input-file "Testing/cli_agentic_loop/example_request.json" `
  --timeout-ms 180000
```
