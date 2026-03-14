const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SandboxBackendService } = require("../src/sandbox_backend");

function plan(name) {
  return {
    name,
    steps: [
      { action: "goto", target: "/" },
      { action: "click", target: "text=Sign Up" }
    ],
    assertions: [{ type: "url_contains", value: "/dashboard" }]
  };
}

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-sandbox-backend-"));
  const api = new SandboxBackendService(tmp);

  const project = api.createProject({ name: "Timeline Test" });
  const forest = api.createForestTemplate({
    projectId: project.projectId,
    name: "web-react-auth",
    baseRuntimeImage: "ghcr.io/test@sha256:aaa",
    startCommand: "npm run dev",
    baseUrl: "http://127.0.0.1:3000"
  });
  const scenarioA = api.createScenario({ projectId: project.projectId, name: "A", planJson: plan("A") });
  const scenarioB = api.createScenario({ projectId: project.projectId, name: "B", planJson: plan("B") });

  const env = api.createEnvironmentVersion({
    projectId: project.projectId,
    forestId: forest.forestId,
    label: "env-v1",
    dockerImageDigest: "ghcr.io/test@sha256:bbb",
    startupCommand: "npm run dev",
    baseUrl: "http://127.0.0.1:3000"
  });

  const run1 = api.startRun({
    projectId: project.projectId,
    forestId: forest.forestId,
    scenarioId: scenarioA.scenarioId,
    environmentVersionId: env.environmentVersionId,
    perturbationProfile: "slow_network"
  });

  api.recordRunStep({ runId: run1.runId, stepIndex: 1, action: "goto", target: "/", status: "pass" });
  api.captureStateSnapshot({
    runId: run1.runId,
    dbSnapshotRef: "snapshots/run1/db.dump",
    authSnapshotRef: "snapshots/run1/auth.json",
    fsSnapshotRef: "snapshots/run1/fs.tar.gz"
  });
  api.completeRun({ runId: run1.runId, status: "fail", failedStep: 2, resultSummary: "failed" });

  const redo = api.redoPreviousTest({ runId: run1.runId });
  api.completeRun({ runId: redo.runId, status: "pass", resultSummary: "ok" });

  const branch = api.branchFromPreviousRun({
    runId: run1.runId,
    branchName: "branch-b",
    scenarioId: scenarioB.scenarioId,
    perturbationProfile: "expired_auth"
  });

  api.completeRun({ runId: branch.runId, status: "fail", failedStep: 1, resultSummary: "auth fail" });

  const memory = api.getNavigableRuntimeMemory({ projectId: project.projectId });
  assert.equal(memory.nodes.length, 3, "expected 3 runs in memory graph");
  assert.equal(memory.edges.length, 2, "expected two parent edges");

  const fullHotload = api.getHotloadBundle({ runId: run1.runId, mode: "full" });
  const quickHotload = api.getHotloadBundle({ runId: run1.runId, mode: "quick" });
  assert.ok(fullHotload.restore.dbSnapshotRef, "full hotload should include db snapshot");
  assert.equal(quickHotload.restore.dbSnapshotRef, null, "quick hotload should omit db snapshot");

  const comparison = api.compareRuns({ baseRunId: run1.runId, candidateRunId: redo.runId });
  assert.equal(comparison.diff.statusChanged, true, "expected status change fail -> pass");

  const branchRun = api.getRun(branch.runId);
  assert.equal(branchRun.parentRunId, run1.runId, "branch parent mismatch");
  assert.equal(branchRun.branchName, "branch-b", "branch name mismatch");

  console.log("sandbox_backend.test.js passed");
}

run();
