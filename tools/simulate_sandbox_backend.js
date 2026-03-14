const path = require("node:path");
const { SandboxBackendService } = require("../src/sandbox_backend");

function samplePlan(label) {
  return {
    label,
    steps: [
      { action: "goto", target: "/" },
      { action: "click", target: "text=Sign Up" },
      { action: "fill", target: "input[name=email]", value: "test@example.com" },
      { action: "click", target: "button[type=submit]" }
    ],
    assertions: [
      { type: "url_contains", value: "/dashboard" },
      { type: "text_visible", value: "Dashboard" }
    ]
  };
}

function runSimulation() {
  const root = path.resolve(__dirname, "..");
  const api = new SandboxBackendService(root);

  const project = api.createProject({ name: "Jungle Timeline Sandbox", repoPath: root });
  const forest = api.createForestTemplate({
    projectId: project.projectId,
    name: "web-react-auth",
    baseRuntimeImage: "ghcr.io/jungle/web-react-auth@sha256:111aaa",
    startCommand: "npm run dev",
    baseUrl: "http://127.0.0.1:3000",
    supportedPerturbations: ["none", "slow_network", "expired_auth"]
  });

  const scenarioA = api.createScenario({
    projectId: project.projectId,
    name: "signup_happy_path",
    planJson: samplePlan("signup_happy_path")
  });

  const envV1 = api.createEnvironmentVersion({
    projectId: project.projectId,
    forestId: forest.forestId,
    label: "v1",
    gitCommit: "abc1234",
    lockfileHash: "lockhash_v1",
    dockerImageDigest: "ghcr.io/jungle/web-react-auth@sha256:222bbb",
    startupCommand: "npm run dev",
    baseUrl: "http://127.0.0.1:3000",
    envFingerprint: { NODE_ENV: "development", FEATURE_FLAG_AUTH: "on" },
    ports: [3000, 5432]
  });

  const run1 = api.startRun({
    projectId: project.projectId,
    forestId: forest.forestId,
    scenarioId: scenarioA.scenarioId,
    environmentVersionId: envV1.environmentVersionId,
    perturbationProfile: "slow_network"
  });

  api.recordRunStep({ runId: run1.runId, stepIndex: 1, action: "goto", target: "/", status: "pass" });
  api.recordRunStep({ runId: run1.runId, stepIndex: 2, action: "click", target: "text=Sign Up", status: "pass" });
  api.recordRunStep({ runId: run1.runId, stepIndex: 3, action: "fill", target: "input[name=email]", status: "pass" });
  api.recordRunStep({ runId: run1.runId, stepIndex: 4, action: "click", target: "button[type=submit]", status: "fail", note: "did not navigate" });

  api.recordArtifact({ runId: run1.runId, type: "video", path: `sandbox_artifacts/${run1.runId}/video.webm` });
  api.recordArtifact({ runId: run1.runId, type: "trace", path: `sandbox_artifacts/${run1.runId}/trace.zip` });
  api.captureStateSnapshot({
    runId: run1.runId,
    dbSnapshotRef: `snapshots/${run1.runId}/db.dump`,
    authSnapshotRef: `snapshots/${run1.runId}/auth.json`,
    fsSnapshotRef: `snapshots/${run1.runId}/fs.tar.gz`
  });
  api.completeRun({
    runId: run1.runId,
    status: "fail",
    failedStep: 4,
    resultSummary: "Submit did not reach /dashboard",
    consoleErrors: ["TypeError: cannot read property 'id' of undefined"]
  });

  const redo = api.redoPreviousTest({ runId: run1.runId });
  api.completeRun({ runId: redo.runId, status: "pass", resultSummary: "Rerun passed" });

  const scenarioB = api.createScenario({
    projectId: project.projectId,
    name: "signup_with_existing_email",
    planJson: samplePlan("signup_with_existing_email")
  });

  const branchRun = api.branchFromPreviousRun({
    runId: run1.runId,
    branchName: "existing-email-branch",
    scenarioId: scenarioB.scenarioId,
    perturbationProfile: "expired_auth"
  });
  api.completeRun({ runId: branchRun.runId, status: "fail", failedStep: 2, resultSummary: "Auth expired before submit" });

  const memoryGraph = api.getNavigableRuntimeMemory({ projectId: project.projectId });
  const hotloadFull = api.getHotloadBundle({ runId: run1.runId, mode: "full" });
  const comparison = api.compareRuns({ baseRunId: run1.runId, candidateRunId: redo.runId });

  const output = {
    project,
    forest,
    runIds: {
      original: run1.runId,
      redo: redo.runId,
      branch: branchRun.runId
    },
    memoryGraph,
    hotloadFull,
    comparison
  };

  console.log(JSON.stringify(output, null, 2));
}

runSimulation();
