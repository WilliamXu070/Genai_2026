# Testing Codex Instance Rules

This local `Testing` instance must use the Jungle tool bridge for implementation verification.

## Required workflow
1. Interpret the user task.
2. Make code changes.
3. Immediately call the local Jungle bridge tool:
   - Using exactly one command: node tools/jungle_tool_bridge.js --mode electron --ui-wait-ms 3000 --request-id codex_manual_1 --project-name Testing --scenario-name ui_open --step assert:ok --url http://127.0.0.1:3000
4. Read the JSON response.
5. If response is failing (`ok: false` or `result.status: fail`), fix code and rerun step 3.
6. Report final output only when Jungle bridge returns success.

## Path + mode requirements
- Assume Codex starts in `.../Genai_2026/Testing`.
- Use `node tools/jungle_tool_bridge.js` as the required verification command.
- Default required mode is `--mode electron` with `--ui-wait-ms 3000` for visible UI verification.
- Use `--mode headless` when GUI launch is unavailable or blocked by sandbox policy.
- For any file write or Jungle bridge command blocked by sandbox permissions, immediately rerun the same command with elevated permissions (no extra retries before escalation).
- Do not run the bridge command repeatedly. Run once per task change, then evaluate that one response.
- If elevated execution returns empty stdout, read the latest `.jungle_tool_io/response_*.json` exactly once instead of re-running the command.

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
