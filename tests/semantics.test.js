const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { analyzeOperationalSemantics, analyzeRunSemantics, checkWebmVideo } = require("../src/runtime/semantics");

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-sem-"));
  const validWebmPath = path.join(tmp, "valid.webm");
  const invalidWebmPath = path.join(tmp, "invalid.webm");

  fs.writeFileSync(validWebmPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86]));
  fs.writeFileSync(invalidWebmPath, Buffer.from("not-webm", "utf8"));

  const valid = checkWebmVideo(validWebmPath);
  const invalid = checkWebmVideo(invalidWebmPath);
  assert.ok(valid.valid, "expected valid webm header to pass");
  assert.ok(!invalid.valid, "expected invalid webm header to fail");

  const passRun = {
    status: "pass",
    summary: "ok",
    steps: [{ status: "pass", action: "goto", target: "/" }],
    artifacts: [{ type: "parser", path: "a" }, { type: "executor", path: "b" }],
    videoPath: validWebmPath
  };
  const failRun = {
    status: "fail",
    summary: "failed",
    steps: [{ status: "fail", action: "click", target: "#missing", note: "not found" }],
    artifacts: [{ type: "parser", path: "a" }, { type: "executor", path: "b" }],
    videoPath: invalidWebmPath
  };

  const passSemantic = analyzeRunSemantics(passRun);
  const failSemantic = analyzeRunSemantics(failRun);
  assert.ok(passSemantic.overallPass, "pass semantic should pass all checks");
  assert.ok(!failSemantic.overallPass, "fail semantic should fail checks");
  assert.ok(failSemantic.wrong.some((line) => line.includes("failed_step_note")), "fail semantic should include failure note");

  const electronPassRun = {
    status: "pass",
    summary: "electron ok",
    targetType: "electron_app",
    steps: [{ status: "pass", action: "click", target: "#refresh-projects" }],
    artifacts: [{ type: "parser", path: "a" }, { type: "executor", path: "b" }],
    videoPath: null
  };
  const electronSemantic = analyzeRunSemantics(electronPassRun);
  assert.ok(electronSemantic.overallPass, "electron pass semantic should not require webm video");

  const operational = analyzeOperationalSemantics(
    {
      hasAppTitle: true,
      hasScenarioPanel: true,
      hasResultPanel: true,
      hasExecuteButton: true,
      hasRunState: true
    },
    {
      preClick: { appTitleVisible: true, scenarioPanelVisible: true, resultPanelVisible: true },
      postClick: { runStateText: "pass", summaryText: "done" }
    },
    { status: "ok", pass: true }
  );
  assert.ok(operational.overallPass, "operational semantic should pass for complete positive signals");

  console.log("semantics.test.js passed");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
