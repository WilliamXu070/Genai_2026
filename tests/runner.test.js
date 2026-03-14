const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { executeScenario } = require("../src/runtime/runner");

async function run() {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-runner-"));
  const events = [];

  const result = await executeScenario({
    input: {
      command: "",
      cwd: process.cwd(),
      url: "http://127.0.0.1:3000",
      steps: [
        { action: "goto", target: "/" },
        { action: "assert", target: "loaded" }
      ]
    },
    runPath,
    emitEvent: (e) => events.push(e)
  });

  assert.equal(result.status, "pass");
  assert.equal(result.steps.length, 2);
  assert.ok(result.artifacts.length >= 2);

  for (const artifact of result.artifacts) {
    assert.ok(fs.existsSync(artifact.path), `artifact missing: ${artifact.path}`);
  }

  assert.ok(events.some((e) => e.type === "status"), "status events missing");
  assert.ok(events.some((e) => e.type === "step"), "step events missing");

  console.log("runner.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
