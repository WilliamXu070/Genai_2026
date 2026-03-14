# Testing Codex Instance Rules

This local `Testing` instance must use the Jungle tool bridge for implementation verification.

## Required workflow
1. Interpret the user task.
2. Make code changes.
3. Immediately call the local Jungle bridge tool:
   - Using : node tools/jungle_tool_bridge.js --mode electron --keep-open --request-id test_ui --project-name Testing --scenario-name ui_open --step assert:ok --url http://127.0.0.1:3000
4. Read the JSON response.
5. If response is failing (`ok: false` or `result.status: fail`), fix code and rerun step 3.
6. Report final output only when Jungle bridge returns success.

## Path + mode requirements
- Assume Codex starts in `.../Genai_2026/Testing`.
- Use `node tools/jungle_tool_bridge.js` (not `node Testing/tools/...`).
- Default required mode is `--mode electron --keep-open` (visible UI verification).
- Use `--mode headless` when GUI launch is unavailable or blocked by sandbox policy.

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
