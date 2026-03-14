const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CatalogService } = require("../src/catalog/service");

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-catalog-test-"));
  fs.mkdirSync(path.join(root, "db", "langflow_agentic_runs"), { recursive: true });
  return root;
}

function writeLangflowFixture(projectRoot) {
  const fixture = {
    plan: {
      objective: "Ensure header is visible."
    },
    execution: {
      status: "pass",
      summary: "Fixture run succeeded",
      video_path: "C:\\tmp\\fixture.webm",
      artifacts: ["C:\\tmp\\fixture.webm", "C:\\tmp\\final.png"]
    }
  };
  const target = path.join(
    projectRoot,
    "db",
    "langflow_agentic_runs",
    "orchestration_1000_fixture.json"
  );
  fs.writeFileSync(target, JSON.stringify(fixture, null, 2), "utf8");
}

(() => {
  const root = makeTempProject();
  writeLangflowFixture(root);
  const service = new CatalogService(root);

  const tests = service.listTests();
  assert.equal(tests.length > 0, true);
  const imported = tests.find((item) => item.id.includes("langflow_orchestration_1000_fixture"));
  assert.equal(Boolean(imported), true);

  const detail = service.getTest(imported.id);
  assert.equal(detail.latestVersion, 1);
  assert.equal(detail.runs.length, 1);

  const updated = service.updateTest({
    testId: imported.id,
    objective: "Ensure header and footer are visible.",
    notes: "Expanded scope.",
    status: "pending_approval"
  });
  assert.equal(updated.latestVersion, 2);
  assert.equal(updated.versions.length, 2);

  const regenerated = service.regenerateTest({
    testId: imported.id,
    instruction: "Include footer link checks."
  });
  assert.equal(regenerated.latestVersion, 3);
  assert.equal(regenerated.status, "pending_approval");
})();

console.log("catalog_service.test.js passed");

