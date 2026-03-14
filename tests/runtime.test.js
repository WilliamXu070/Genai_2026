const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { JungleManager } = require("../src/runtime/manager");

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-test-"));
  const manager = new JungleManager(tmp);

  const events = [];
  const run = await manager.startRun(
    {
      command: "",
      projectName: "Test",
      scenarioName: "Runtime smoke",
      steps: [{ action: "goto", target: "/" }],
      url: "http://127.0.0.1:3000"
    },
    (evt) => events.push(evt)
  );

  assert.ok(run.runId, "runId should exist");
  assert.ok(["pass", "fail"].includes(run.status), "status should be pass or fail");
  assert.ok(Array.isArray(run.artifacts), "artifacts should be array");
  assert.ok(events.some((e) => e.type === "run_started"), "run_started event missing");
  assert.ok(events.some((e) => e.type === "run_finished"), "run_finished event missing");

  console.log("runtime.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
