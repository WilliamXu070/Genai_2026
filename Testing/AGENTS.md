# Testing Codex Instance Rules

This local `Testing` instance must use the Jungle tool bridge for implementation verification.

## Required workflow
1. Interpret the user task.
2. Make code changes.
3. Immediately call the local Jungle bridge tool:
   - Preferred (run from `Testing/` working directory, no escaping issues):
  node tools/jungle_tool_bridge.js --mode headless --request-id codex_manual_1 --project-name Testing --scenario-name codex_bridge_smoke --step assert:codex-to-jungle --url http://127.0.0.1:3000
   - Alternative (`input-file`):
  node tools/jungle_tool_bridge.js --mode headless --input-file .jungle_tool_io/request.json
   - JSON via stdin:
  Get-Content .jungle_tool_io/request.json | node tools/jungle_tool_bridge.js --mode headless --input-stdin
   - This call is blocking: do not continue until JSON response is returned.
4. Read the JSON response.
5. If response is failing (`ok: false` or `result.status: fail`), fix code and rerun step 3.
6. Report final output only when Jungle bridge returns success.

## Path + mode requirements
- Assume Codex starts in `.../Genai_2026/Testing`.
- Use `node tools/jungle_tool_bridge.js` (not `node Testing/tools/...`).
- Default required mode is `--mode headless`.
- Use `--mode electron` only when explicitly asked to verify GUI-coupled behavior.

## Tool contract
- Input JSON shape:
  - `requestId` (string)
  - `type` = `"jungle:start-run"`
  - `payload` object:
    - `projectName` (optional string)
    - `scenarioName` (optional string)
    - `steps` (optional array)
    - `url` (optional string)
- Output JSON shape:
  - `ok` (boolean)
  - `requestId` (string or null)
  - `completedAt` (ISO timestamp)
  - `result` (present on success)
  - `error` (present on failure)

## Current hardcoded scope
- The Jungle bridge currently supports only:
  - `type: "jungle:start-run"`
