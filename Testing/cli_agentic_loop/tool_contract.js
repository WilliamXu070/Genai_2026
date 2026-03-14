function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateBridgeRequest(request) {
  const errors = [];
  if (!isObject(request)) {
    return { valid: false, errors: ["request must be an object"] };
  }
  if (!isNonEmptyString(request.requestId || "")) {
    errors.push("requestId is required and must be a non-empty string");
  }
  if ((request.type || "jungle:start-run") !== "jungle:start-run") {
    errors.push("type must be 'jungle:start-run'");
  }
  if (!isObject(request.payload)) {
    errors.push("payload is required and must be an object");
    return { valid: errors.length === 0, errors };
  }
  const payload = request.payload;
  if (!isNonEmptyString(payload.url || "")) {
    errors.push("payload.url is required and must be a non-empty string");
  }
  if (!isNonEmptyString(payload.objective || payload.task || payload.scenarioName || "")) {
    errors.push("payload must include one of objective/task/scenarioName");
  }
  const severity = asNumber(payload.severityThreshold, 8);
  if (severity < 0 || severity > 10) {
    errors.push("payload.severityThreshold must be between 0 and 10");
  }
  const retries = asNumber(payload.maxRetries, 2);
  if (retries < 0 || retries > 10) {
    errors.push("payload.maxRetries must be between 0 and 10");
  }
  return { valid: errors.length === 0, errors };
}

function normalizeBridgeRequest(request, repoRoot) {
  const payload = request?.payload || {};
  return {
    feature_goal: payload.objective || payload.task || payload.scenarioName || "Validate generated code behavior",
    environment_context: payload.environmentContext || "CLI-driven Codex to orchestrator loop",
    target_url: payload.url || request?.url || "",
    constraints: payload.constraints || "No destructive actions",
    severity_threshold: asNumber(payload.severityThreshold, 8.0),
    max_retries: Math.max(0, Math.min(10, asNumber(payload.maxRetries, 2))),
    project_root: payload.projectRoot || repoRoot
  };
}

function validateOrchestratorResponse(response) {
  const errors = [];
  if (!isObject(response)) {
    return { valid: false, errors: ["response must be an object"] };
  }
  if (!isObject(response.plan)) {
    errors.push("response.plan missing");
  }
  if (!isObject(response.execution)) {
    errors.push("response.execution missing");
  }
  if (!isObject(response.critique)) {
    errors.push("response.critique missing");
  }
  if (!isNonEmptyString(response.final_verdict || "")) {
    errors.push("response.final_verdict missing");
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateBridgeRequest,
  normalizeBridgeRequest,
  validateOrchestratorResponse
};
