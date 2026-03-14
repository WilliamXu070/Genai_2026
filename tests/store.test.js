const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RunStore } = require("../src/runtime/store");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-store-"));
const store = new RunStore(tmp);

const created = store.createRun({
  projectName: "StoreTest",
  scenarioName: "Create and update",
  command: "",
  url: "http://127.0.0.1:3000"
});

assert.ok(created.run.runId, "runId missing");
assert.ok(fs.existsSync(created.runPath), "run folder missing");

const updated = store.updateRun(created.run.runId, (draft) => ({
  ...draft,
  status: "pass",
  resultSummary: "ok"
}));

assert.equal(updated.status, "pass");
assert.equal(updated.resultSummary, "ok");

const runs = store.listRuns(10);
assert.ok(runs.length >= 1, "runs list empty");
assert.equal(runs[0].runId, created.run.runId);

console.log("store.test.js passed");
