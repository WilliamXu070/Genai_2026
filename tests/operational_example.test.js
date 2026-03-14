const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runOperationalExample } = require("../src/runtime/operational_example");

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-ops-"));
  fs.writeFileSync(path.join(tmp, ".env"), "GEMINI_API_KEY=\n", "utf8");

  const { outPath, report } = await runOperationalExample(tmp);

  assert.ok(fs.existsSync(outPath), "report should exist");
  assert.ok(report.parsedState.hasAppTitle, "app title cue missing");
  assert.ok(report.parsedState.hasScenarioPanel, "scenario panel cue missing");
  assert.ok(report.uiInteraction, "ui interaction result missing");
  assert.ok(report.uiInteraction.preClick.appTitleVisible, "ui title not visible in browser");
  assert.ok(report.uiInteraction.postClick.runStateText === "pass", "ui state did not transition");
  assert.ok(report.semantic, "semantic result missing");

  console.log("operational_example.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
