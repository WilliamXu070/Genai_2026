const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AgenticMySqlPersistenceService, ensureSummaryArray } = require("../src/runtime/agentic_mysql_persistence");
const { getClientStatus, getPool } = require("../src/db/mysql_agentic_client");
const { getAgenticMySqlConfig } = require("../src/db/mysql_agentic_config");

function loadDotEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index < 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function maskSecret(value) {
  if (!value) {
    return "";
  }
  return "***";
}

function maskUri(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch (_) {
    return "***";
  }
}

function resolveSampleVideoPath(projectRoot) {
  const candidates = [
    path.join(projectRoot, "animation.mp4")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const dbDir = path.join(projectRoot, "db");
  if (!fs.existsSync(dbDir)) {
    return null;
  }

  const stack = [dbDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && /\.(webm|mp4)$/i.test(entry.name)) {
        return fullPath;
      }
    }
  }

  return null;
}

function getSafeConfig() {
  const config = getAgenticMySqlConfig();
  return {
    ...config,
    password: maskSecret(config.password),
    uri: maskUri(config.uri)
  };
}

async function waitForReady(service, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await service.ping();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`MySQL did not become ready within ${timeoutMs}ms: ${lastError?.message || "unknown error"}`);
}

async function cleanupVerificationData(projectName) {
  const pool = getPool();
  if (!pool) {
    return;
  }

  const [projects] = await pool.query("SELECT id FROM projects WHERE name = ?", [projectName]);
  for (const project of projects) {
    await pool.query("DELETE FROM loop_iterations WHERE test_run_id IN (SELECT id FROM test_runs WHERE project_id = ?)", [project.id]);
    await pool.query("DELETE FROM test_runs WHERE project_id = ?", [project.id]);
    await pool.query("DELETE FROM projects WHERE id = ?", [project.id]);
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  loadDotEnv(projectRoot);

  const status = getClientStatus();
  console.log(
    JSON.stringify(
      {
        clientStatus: status,
        mysqlConfig: getSafeConfig()
      },
      null,
      2
    )
  );

  if (!status.enabled) {
    throw new Error(`MySQL persistence is not enabled: ${status.reason}`);
  }

  const service = new AgenticMySqlPersistenceService();
  await waitForReady(service, Number(process.env.MYSQL_VERIFY_TIMEOUT_MS || 30000));
  const sampleVideoPath = resolveSampleVideoPath(projectRoot);

  const projectName = "Jungle MySQL Verification";
  const testingInstructions = [
    "Smoke-test the MySQL persistence path.",
    "Create a project, create a run, persist loop state, finalize, then read it back."
  ].join("\n");

  await cleanupVerificationData(projectName);

  const project = await service.getOrCreateProjectByName(projectName);
  assert(project?.id, "Expected project id from getOrCreateProjectByName()");

  const draftingRun = await service.createDraftingRun({
    projectId: project.id,
    testingInstructions: "Drafting verification run before approval.",
    threePointSummary: [
      "Draft packet created.",
      "Execution has not started.",
      "Approval is still pending."
    ],
    draftPayload: {
      objective: "Verify MySQL approval gating persistence",
      projectName,
      url: "http://127.0.0.1:3000/verify",
      notes: "Smoke-test the approval gate persistence path.",
      additions: "",
      maxAttempts: 2,
      attempt: 1,
      forestId: "verify_forest",
      treeId: "verify_tree",
      procedure: {
        summary: "Verification procedure",
        notes: "Persist approval-gated execution state",
        steps: [{ action: "goto", target: "http://127.0.0.1:3000/verify" }]
      },
      requestParser: {
        normalizedSteps: [{ action: "goto", target: "http://127.0.0.1:3000/verify" }]
      }
    }
  });
  assert(draftingRun?.id, "Expected drafting run id");
  assert.equal(draftingRun.status, "drafting", "Expected newly created run to be drafting");

  const approvalRun = await service.markRunAwaitingApproval({
    testRunId: draftingRun.id,
    testingInstructions,
    threePointSummary: [
      "Approval requested successfully.",
      "Run is waiting in the approval queue.",
      "Execution is blocked until approval."
    ],
    draftPayload: draftingRun.draftPayload
  });
  assert.equal(approvalRun?.status, "to_be_approved", "Expected run to move into to_be_approved");
  assert(approvalRun.approvalRequestedAt, "Expected approval_requested_at to be set");

  const awaitingApproval = await service.listAwaitingApprovalRuns(project.id);
  assert(awaitingApproval.some((item) => item.id === draftingRun.id), "Expected run to appear in awaiting approval list");

  const approvedRun = await service.approveRun({
    runId: draftingRun.id,
    approvedBy: "verify-script"
  });
  assert.equal(approvedRun?.status, "approved", "Expected run to move into approved");
  assert(approvedRun.approvedAt, "Expected approved_at to be set");

  const claimedRun = await service.claimApprovedRunForExecution(draftingRun.id);
  assert.equal(claimedRun?.status, "in_progress", "Expected run to move into in_progress after claim");

  const inProgressRuns = await service.listInProgressRuns(project.id);
  assert(inProgressRuns.some((item) => item.id === draftingRun.id), "Expected run to appear in the in-progress list");

  await service.persistLoopAndRunState({
    testRunId: draftingRun.id,
    loopNumber: 1,
    loopStatus: "failed",
    stepSummary: "Loop 1 simulated failure persisted for verification.",
    artifacts: {
      screenshot_refs: ["smoke_loop_1.png"],
      console_errors: ["Simulated retry trigger"],
      video_chunk_refs: [],
      critic_output: { verdict: "retry" },
      structured_metrics: { attempt: 1, gate: "failed" },
      artifact_refs: [{ type: "screenshot", path: "smoke_loop_1.png" }]
    },
    runStatus: "in_progress",
    lastErrorText: "Simulated retry trigger"
  });

  await service.persistLoopAndRunState({
    testRunId: draftingRun.id,
    loopNumber: 2,
    loopStatus: "passed",
    stepSummary: "Loop 2 simulated success persisted for verification.",
    artifacts: {
        screenshot_refs: ["smoke_loop_2.png"],
        console_errors: [],
        video_chunk_refs: sampleVideoPath ? [sampleVideoPath] : [],
        critic_output: { verdict: "pass" },
        structured_metrics: { attempt: 2, gate: "passed" },
        artifact_refs: [
          { type: "screenshot", path: "smoke_loop_2.png" },
          ...(sampleVideoPath ? [{ type: "video", path: sampleVideoPath }] : [])
        ]
      },
      runStatus: "in_progress",
    lastErrorText: null
  });

  const summary = ensureSummaryArray([
    "MySQL smoke run persisted successfully.",
    "Loop timeline records were written and read back.",
    "Final run status transitioned to passed."
  ]);

  await service.finalizeRun({
    testRunId: draftingRun.id,
    executionTimeMs: 1234,
    loopCount: 2,
    status: "passed",
    testingInstructions,
    videoReference: sampleVideoPath,
    threePointSummary: summary,
    lastErrorText: null
  });

  const projects = await service.listProjects();
  const storedProject = projects.find((item) => item.id === project.id);
  assert(storedProject, "Expected verification project to appear in listProjects()");

  const runs = await service.listTestRunsByProject(project.id);
  const storedRun = runs.find((item) => item.id === draftingRun.id);
  assert(storedRun, "Expected verification run to appear in listProjectTestRuns()");
  assert.equal(storedRun.status, "passed", "Expected finalized run status to be passed");
  assert.equal(storedRun.loopCount, 2, "Expected finalized run loop count to be 2");
  assert.equal(storedRun.threePointSummary.length, 3, "Expected strict three-point summary");

  const detail = await service.getTestRunDetail(draftingRun.id);
  assert(detail, "Expected getProjectTestRun() to return the verification run");
  assert.equal(detail.status, "passed", "Expected detail status to be passed");
  assert.equal(detail.loopIterations.length, 2, "Expected two loop iterations");
  assert.equal(detail.loopIterations[0].loopNumber, 1, "Expected loop 1 to be stored first");
  assert.equal(detail.loopIterations[1].loopNumber, 2, "Expected loop 2 to be stored second");

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId: project.id,
        runId: draftingRun.id,
        projectName,
        runStatus: detail.status,
        videoReference: detail.videoReference,
        loopCount: detail.loopCount,
        loopStatuses: detail.loopIterations.map((loop) => ({
          loopNumber: loop.loopNumber,
          status: loop.status
        })),
        threePointSummary: detail.threePointSummary
      },
      null,
      2
    )
  );

  await cleanupVerificationData(projectName);
}

main()
  .then(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error.stack || error.message || String(error));
    try {
      await cleanupVerificationData("Jungle MySQL Verification");
    } catch (_) {
      // ignore verification cleanup failures during error handling
    }
    const pool = getPool();
    if (pool) {
      try {
        await pool.end();
      } catch (_) {
        // ignore pool shutdown failures during error handling
      }
    }
    process.exit(1);
  });
