const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { JungleManager } = require("../src/runtime/manager");

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-manager-"));
  const manager = new JungleManager(tmp);
  const events = [];

  const run = await manager.startRun(
    {
      projectName: "ManagerTest",
      scenarioName: "Lifecycle",
      command: "",
      steps: [{ action: "goto", target: "/" }],
      url: "http://127.0.0.1:3000"
    },
    (evt) => events.push(evt)
  );

  assert.ok(run.runId, "run id missing");
  assert.ok(["pass", "fail"].includes(run.status), "invalid status");
  assert.ok(events.some((e) => e.type === "run_started"), "run_started missing");
  assert.ok(events.some((e) => e.type === "run_finished"), "run_finished missing");

  const blueprint = manager.getTodoBlueprint();
  assert.ok(Array.isArray(blueprint.completed), "blueprint.completed missing");
  assert.ok(Array.isArray(blueprint.blankBoxes), "blueprint.blankBoxes missing");

  console.log("manager.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
