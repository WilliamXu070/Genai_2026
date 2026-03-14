# Agent-Centric Langflow Implementation

This implementation adds an agent-first orchestration path that uses:

- OpenAI for planning/procedure/code-generation logic.
- Playwright tool execution for video artifact generation.
- Gemini for aggressive critique and severity scoring.

## Core Modules

- `pipeline/agentic_orchestrator.py`
- `pipeline/openai_execution_agent.py`
- `pipeline/agentic_tools.py`
- `pipeline/gemini_critic_agent.py`
- `agentic_flow_blueprint.yaml`

## Runtime Sequence

1. Build environment snapshot from repository + input.
2. OpenAI execution agent generates executable plan.
3. Playwright tool executes generated plan and stores artifacts/video.
4. Gemini critic produces defect report with severity.
5. Severity gate applies:
   - `overall_severity > threshold` => fail/escalate
   - otherwise pass.
6. Persist orchestration output to:
   - `db/langflow_agentic_runs/orchestration_<timestamp>.json`

## Demo Run

Serve demo site:

```powershell
cd db/demo_animation_site_2
py -m http.server 8088
```

Run orchestrator demo:

```powershell
cd ..
py -m langflow_orchestrator.pipeline.agentic_demo
```

## Note on Video Critique

Current Gemini critic call is text-context based (execution trace + video metadata/path).
If full pixel-level video interpretation is required, wire a media-upload capable Gemini path and pass video bytes/URI directly.

## Thinking / Depth Controls (Env Vars)

- `OPENAI_REASONING_EFFORT=high|medium|low` (default `high`)
- `OPENAI_TEMPERATURE=0.1`
- `OPENAI_ENABLE_REASONING_PARAM=1` (optional; sends reasoning param to OpenAI API)
- `GEMINI_TEMPERATURE=0.1`
- `GEMINI_MAX_OUTPUT_TOKENS=8192`
- `CRITIC_CHAIN_PASSES=1|2|3` (default `3`)
