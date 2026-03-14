# Import And Test

## Files

- Flow JSON: `langflow_orchestrator/jungle_orchestrator.langflow.json`
- Validator: `langflow_orchestrator/validate_langflow_flow.py`

## 1) Validate the JSON against Langflow schema

Use the same Python environment where `langflow` is installed:

```powershell
py langflow_orchestrator\validate_langflow_flow.py
```

This checks:

- JSON shape is accepted by Langflow `FlowCreate` model.
- Node/edge counts are valid.
- All `LanguageModelComponent` nodes use `OpenAI` and `OPENAI_API_KEY`.

## 2) Import into Langflow UI

1. Start Langflow:
```powershell
py -m langflow run
```
2. In the UI, import `langflow_orchestrator/jungle_orchestrator.langflow.json`.
3. Open each `Language Model` node and confirm:
- provider: `OpenAI`
- model: `gpt-5-mini`
- API key source: `OPENAI_API_KEY`

## 3) Run test input in the playground

Use input like:

`Create an automated test task for a counter app and prepare Playwright execution payload.`

Expected behavior:

- Stage 1 output: objective + inspection requirements + procedure outline JSON.
- Stage 2 output: procedure + request parser JSON.
- Stage 3 output: executor + runner payload + persistence contract JSON.

## Notes

- `langflow lfx run` currently fails with starter-project JSON format in this environment due a `model` field type validation mismatch.
- This does not block UI import or schema validation; use UI runtime for actual execution tests.

