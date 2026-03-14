const assert = require("node:assert");
const { parseArgs } = require("../Testing/tools/jungle_tool_bridge");

(() => {
  const parsed = parseArgs(["--input-json", "{\"type\":\"jungle:start-run\"}"]);
  assert.equal(parsed.timeoutMs, 90000);
})();

(() => {
  const parsed = parseArgs(["--input-json", "{}", "--timeout-ms", "1234"]);
  assert.equal(parsed.timeoutMs, 1234);
})();

(() => {
  let threw = false;
  try {
    parseArgs([]);
  } catch (error) {
    threw = true;
    assert.match(error.message, /Provide --input-json, --input-file, --input-stdin/);
  }
  assert.equal(threw, true);
})();

(() => {
  const parsed = parseArgs([
    "--request-id",
    "req-123",
    "--project-name",
    "Testing",
    "--scenario-name",
    "codex-bridge-file-create",
    "--step",
    "assert:codex->jungle",
    "--url",
    "http://127.0.0.1:3000"
  ]);
  assert.equal(parsed.inlineRequest.requestId, "req-123");
  assert.equal(parsed.inlineRequest.type, "jungle:start-run");
  assert.equal(parsed.inlineRequest.payload.projectName, "Testing");
  assert.equal(parsed.inlineRequest.payload.scenarioName, "codex-bridge-file-create");
  assert.equal(parsed.inlineRequest.payload.url, "http://127.0.0.1:3000");
  assert.equal(parsed.inlineRequest.payload.steps.length, 1);
  assert.equal(parsed.inlineRequest.payload.steps[0].action, "assert");
  assert.equal(parsed.inlineRequest.payload.steps[0].target, "codex->jungle");
})();

(() => {
  const parsed = parseArgs(["--input-stdin"]);
  assert.equal(parsed.inputStdin, true);
})();

(() => {
  const parsed = parseArgs(["--input-json", "{}", "--storage-root", ".\\Testing"]);
  assert.equal(parsed.storageRoot, ".\\Testing");
})();

console.log("jungle_tool_bridge.test.js passed");
