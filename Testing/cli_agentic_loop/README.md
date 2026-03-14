# CLI Agentic Loop

Terminal-only Codex-to-orchestrator feedback loop.

## Purpose

After code generation/editing, run the Langflow orchestrator test pipeline, parse failures, and feed actionable fix directives back into the next Codex iteration until success.

## Run

```powershell
node Testing/cli_agentic_loop/run_cli_loop.js `
  --task "Validate generated implementation against target behavior" `
  --url "http://127.0.0.1:8088" `
  --max-iterations 5 `
  --severity-threshold 8 `
  --max-retries 2 `
  --codex-command "codex exec \"Read {{feedback_file}} and patch code in {{workspace}}\""
```

`--codex-command` is optional. If omitted, the loop only runs orchestration and feedback extraction.

## Outputs

- `Testing/cli_agentic_loop/runs/cli_loop_<timestamp>/loop_summary.json`
- `Testing/cli_agentic_loop/runs/cli_loop_<timestamp>/iteration_<n>/bridge_request.json`
- `Testing/cli_agentic_loop/runs/cli_loop_<timestamp>/iteration_<n>/bridge_response.json`
- `Testing/cli_agentic_loop/runs/cli_loop_<timestamp>/iteration_<n>/fix_packet.json`
- `Testing/cli_agentic_loop/runs/cli_loop_<timestamp>/iteration_<n>/codex_command_result.json` (when codex command is provided)
