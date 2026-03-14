import json
from pathlib import Path

from langflow.services.database.models.flow.model import FlowCreate


def validate_flow(path: Path) -> None:
  payload = json.loads(path.read_text(encoding="utf-8"))
  model = FlowCreate.model_validate(payload)

  nodes = model.data.get("nodes", [])
  edges = model.data.get("edges", [])
  lm_nodes = [node for node in nodes if node.get("data", {}).get("type") == "LanguageModelComponent"]

  print(f"Validated flow name: {model.name}")
  print(f"Endpoint: {model.endpoint_name}")
  print(f"Nodes: {len(nodes)} | Edges: {len(edges)} | LanguageModel nodes: {len(lm_nodes)}")

  for node in lm_nodes:
    template = node["data"]["node"]["template"]
    api_key_value = template.get("api_key", {}).get("value")
    model_value = template.get("model", {}).get("value", [{}])[0]
    provider = model_value.get("provider")
    model_name = model_value.get("name")
    print(
      f"- {node['id']} api_key={api_key_value} provider={provider} model={model_name}"
    )

  if any(
    node["data"]["node"]["template"].get("api_key", {}).get("value") != "OPENAI_API_KEY"
    for node in lm_nodes
  ):
    raise ValueError("Expected all LanguageModelComponent nodes to reference OPENAI_API_KEY")

  if any(
    node["data"]["node"]["template"].get("model", {}).get("value", [{}])[0].get("provider") != "OpenAI"
    for node in lm_nodes
  ):
    raise ValueError("Expected all LanguageModelComponent nodes to use OpenAI provider")

  print("Flow validation checks passed.")


if __name__ == "__main__":
  validate_flow(Path("langflow_orchestrator/jungle_orchestrator.langflow.json"))

