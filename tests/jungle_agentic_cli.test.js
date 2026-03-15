const assert = require("node:assert");
const path = require("node:path");
const { normalizeRequest, parseArgs, readInput } = require("../tools/jungle_agentic_cli");

(() => {
  const parsed = parseArgs([
    "--project-root",
    ".\\Testing",
    "--project-name",
    "Demo Project",
    "--task",
    "Prepare approval-gated run",
    "--url",
    "http://127.0.0.1:3000",
    "--notes",
    "check critical flow",
    "--additions",
    "verify nav",
    "--max-attempts",
    "2",
    "--skip-codex"
  ]);
  assert.equal(parsed.inlineRequest.type, "agentic:orchestrate-task");
  assert.equal(parsed.inlineRequest.payload.projectRoot, ".\\Testing");
  assert.equal(parsed.inlineRequest.payload.projectName, "Demo Project");
  assert.equal(parsed.inlineRequest.payload.task, "Prepare approval-gated run");
  assert.equal(parsed.inlineRequest.payload.url, "http://127.0.0.1:3000");
  assert.equal(parsed.inlineRequest.payload.notes, "check critical flow");
  assert.equal(parsed.inlineRequest.payload.additions, "verify nav");
  assert.equal(parsed.inlineRequest.payload.maxAttempts, 2);
  assert.equal(parsed.inlineRequest.payload.skipCodex, true);
})();

(() => {
  const parsed = parseArgs(["--input-json", "{\"type\":\"agentic:orchestrate-task\",\"payload\":{\"task\":\"Demo\"}}"]);
  const request = readInput(parsed);
  assert.equal(request.type, "agentic:orchestrate-task");
  assert.equal(request.payload.task, "Demo");
})();

(() => {
  const normalized = normalizeRequest({
    requestId: "req-1",
    type: "agentic:orchestrate-task",
    payload: {
      projectRoot: ".\\Testing",
      objective: "Drive approval queue",
      skipCodex: "true"
    }
  });
  assert.equal(normalized.requestId, "req-1");
  assert.equal(normalized.payload.projectName, path.basename(path.resolve(".\\Testing")));
  assert.equal(normalized.payload.task, "Drive approval queue");
  assert.equal(normalized.payload.skipCodex, true);
  assert.equal(normalized.payload.url, "http://127.0.0.1:3000");
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
  let threw = false;
  try {
    normalizeRequest({
      type: "jungle:start-run",
      payload: {
        task: "wrong type"
      }
    });
  } catch (error) {
    threw = true;
    assert.match(error.message, /Unsupported request type/);
  }
  assert.equal(threw, true);
})();

console.log("jungle_agentic_cli.test.js passed");
