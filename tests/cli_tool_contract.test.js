const assert = require("node:assert");
const {
  normalizeBridgeRequest,
  validateBridgeRequest,
  validateOrchestratorResponse
} = require("../Testing/cli_agentic_loop/tool_contract");

(() => {
  const valid = validateBridgeRequest({
    requestId: "r1",
    type: "jungle:start-run",
    payload: {
      objective: "test",
      url: "http://127.0.0.1:8088",
      severityThreshold: 8,
      maxRetries: 2
    }
  });
  assert.equal(valid.valid, true);
})();

(() => {
  const invalid = validateBridgeRequest({
    requestId: "",
    type: "wrong",
    payload: { url: "", severityThreshold: 99 }
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 3);
})();

(() => {
  const mapped = normalizeBridgeRequest(
    {
      requestId: "r2",
      type: "jungle:start-run",
      payload: { task: "task text", url: "http://127.0.0.1:8088", maxRetries: 99 }
    },
    "C:\\repo"
  );
  assert.equal(mapped.feature_goal, "task text");
  assert.equal(mapped.target_url, "http://127.0.0.1:8088");
  assert.equal(mapped.max_retries, 10);
})();

(() => {
  const ok = validateOrchestratorResponse({
    plan: {},
    execution: {},
    critique: {},
    final_verdict: "pass"
  });
  assert.equal(ok.valid, true);
})();

(() => {
  const bad = validateOrchestratorResponse({ final_verdict: "" });
  assert.equal(bad.valid, false);
})();

console.log("cli_tool_contract.test.js passed");
