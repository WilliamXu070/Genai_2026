const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AgenticLoopManager } = require("../src/runtime/agentic_loop");
const { ensureSummaryArray } = require("../src/runtime/agentic_mysql_persistence");

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function waitForRunStatus(manager, runId, expectedStatus, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const detail = await manager.getProjectTestRun(runId);
    if (detail?.status === expectedStatus) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return manager.getProjectTestRun(runId);
}

class FakePersistence {
  constructor() {
    this.project = {
      id: "project_1",
      name: "Approval Test Project",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.runs = new Map();
    this.loopIterations = new Map();
    this.sequence = 1;
  }

  isEnabled() {
    return true;
  }

  async listProjects() {
    return [clone(this.project)];
  }

  async getOrCreateProjectByName(projectName) {
    this.project.name = projectName;
    this.project.updatedAt = nowIso();
    return clone(this.project);
  }

  async createDraftingRun(input) {
    const runId = `test_run_${this.sequence += 1}`;
    const run = {
      id: runId,
      projectId: input.projectId,
      projectName: this.project.name,
      executionTimeMs: null,
      loopCount: 0,
      status: "drafting",
      testingInstructions: input.testingInstructions || "",
      videoReference: null,
      threePointSummary: ensureSummaryArray(input.threePointSummary),
      lastErrorText: null,
      approvalRequestedAt: null,
      approvedAt: null,
      approvedBy: null,
      cancelledAt: null,
      draftPayload: input.draftPayload || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.runs.set(runId, run);
    this.loopIterations.set(runId, []);
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async markRunAwaitingApproval(input) {
    const run = this.runs.get(input.testRunId);
    assert.equal(run.status, "drafting");
    run.status = "to_be_approved";
    run.testingInstructions = input.testingInstructions || run.testingInstructions;
    run.threePointSummary = ensureSummaryArray(input.threePointSummary);
    run.draftPayload = clone(input.draftPayload || null);
    run.approvalRequestedAt = run.approvalRequestedAt || nowIso();
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async markRunFailedDuringDraft(input) {
    const run = this.runs.get(input.testRunId);
    run.status = "failed";
    run.lastErrorText = input.lastErrorText || "draft failure";
    run.threePointSummary = ensureSummaryArray(input.threePointSummary);
    run.updatedAt = nowIso();
    return clone(run);
  }

  async approveRun(input) {
    const run = this.runs.get(input.runId);
    assert.equal(run.status, "to_be_approved");
    if (typeof input.testingInstructions === "string") {
      run.testingInstructions = input.testingInstructions;
      run.draftPayload = {
        ...(run.draftPayload || {}),
        approvedTestingInstructions: input.testingInstructions,
        approvalInstructionEditedAt: nowIso(),
        approvalInstructionEditedBy: input.approvedBy || null
      };
    }
    run.status = "approved";
    run.approvedAt = nowIso();
    run.approvedBy = input.approvedBy || null;
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async updateRunTestingInstructions(input) {
    const run = this.runs.get(input.runId);
    if (!run) {
      return null;
    }
    assert.equal(run.status, "to_be_approved");
    run.testingInstructions = typeof input.testingInstructions === "string" ? input.testingInstructions : run.testingInstructions;
    run.draftPayload = {
      ...(run.draftPayload || {}),
      approvedTestingInstructions: run.testingInstructions,
      approvalInstructionEditedAt: nowIso(),
      approvalInstructionEditedBy: input.editedBy || null
    };
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async cancelRun(input) {
    const run = this.runs.get(input.runId);
    if (!run) {
      return null;
    }
    run.status = "cancelled";
    run.cancelledAt = run.cancelledAt || nowIso();
    run.lastErrorText = input.reason || "cancelled";
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async claimApprovedRunForExecution(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== "approved") {
      return null;
    }
    run.status = "in_progress";
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async updateRunDraftPayload(input) {
    const run = this.runs.get(input.testRunId);
    run.testingInstructions = input.testingInstructions || run.testingInstructions;
    run.threePointSummary = ensureSummaryArray(input.threePointSummary);
    run.draftPayload = clone(input.draftPayload || null);
    run.updatedAt = nowIso();
    return clone(run);
  }

  async listRunsByStatuses(statuses, options = {}) {
    const filtered = Array.from(this.runs.values())
      .filter((run) => statuses.includes(run.status))
      .filter((run) => !options.projectId || run.projectId === options.projectId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const limited = Number.isFinite(options.limit) ? filtered.slice(0, options.limit) : filtered;
    return clone(limited);
  }

  async listAwaitingApprovalRuns(projectId = null) {
    return this.listRunsByStatuses(["to_be_approved"], { projectId });
  }

  async listInProgressRuns(projectId = null) {
    return this.listRunsByStatuses(["drafting", "approved", "in_progress"], { projectId });
  }

  async listTestRunsByProject(projectId) {
    return this.listRunsByStatuses(
      ["drafting", "to_be_approved", "approved", "in_progress", "passed", "failed", "max_loops_reached", "cancelled"],
      { projectId }
    );
  }

  async getRunRecord(runId) {
    return clone(this.runs.get(runId) || null);
  }

  async getRunStatus(runId) {
    return this.runs.get(runId)?.status || null;
  }

  async getLoopCount(runId) {
    return Number(this.runs.get(runId)?.loopCount || 0);
  }

  async persistLoopAndRunState(input) {
    const run = this.runs.get(input.testRunId);
    if (run.status === "cancelled") {
      return clone(run);
    }
    assert.equal(run.status, "in_progress");

    const loops = this.loopIterations.get(input.testRunId) || [];
    const loopRecord = {
      id: `${input.testRunId}_loop_${input.loopNumber}`,
      testRunId: input.testRunId,
      loopNumber: input.loopNumber,
      status: input.loopStatus,
      stepSummary: input.stepSummary || null,
      artifacts: clone(input.artifacts || {}),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const existingIndex = loops.findIndex((loop) => loop.loopNumber === input.loopNumber);
    if (existingIndex >= 0) {
      loops[existingIndex] = loopRecord;
    } else {
      loops.push(loopRecord);
    }
    this.loopIterations.set(input.testRunId, loops);

    run.loopCount = input.loopNumber;
    run.status = input.runStatus;
    run.lastErrorText = input.lastErrorText || null;
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async finalizeRun(input) {
    const run = this.runs.get(input.testRunId);
    if (run.status === "cancelled" && input.status !== "cancelled") {
      return clone(run);
    }
    run.executionTimeMs = input.executionTimeMs;
    run.loopCount = input.loopCount;
    run.status = input.status;
    run.testingInstructions = input.testingInstructions || run.testingInstructions;
    run.videoReference = input.videoReference || null;
    run.threePointSummary = ensureSummaryArray(input.threePointSummary);
    run.lastErrorText = input.lastErrorText || null;
    if (input.status === "cancelled") {
      run.cancelledAt = run.cancelledAt || nowIso();
    }
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async getTestRunDetail(runId) {
    const run = await this.getRunRecord(runId);
    if (!run) {
      return null;
    }
    run.loopIterations = clone(this.loopIterations.get(runId) || []);
    return run;
  }
}

function makeDraft(manager, input, suffix) {
  const forest =
    (input.forestId && manager.store.getForest(input.forestId)) ||
    manager.store.createForest({
      projectName: input.projectName || "Approval Test Project",
      url: input.url,
      objective: input.objective || "Validate critical user flow"
    });
  const procedure = {
    summary: `Draft ${suffix}`,
    notes: input.notes || "",
    steps: [
      { action: "goto", target: input.url },
      { action: "assertVisible", target: "text=Ready" }
    ]
  };
  const { tree } = manager.store.addTree(forest.forestId, {
    procedure,
    requestParser: {
      normalizedSteps: [
        { action: "goto", target: input.url },
        { action: "assertVisible", target: "text=Ready" }
      ]
    },
    executionProfile: { recordVideo: true, mode: "playwright" }
  });
  return {
    forestId: forest.forestId,
    tree
  };
}

async function runApprovalResumeTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-approval-"));
  const manager = new AgenticLoopManager(tmp);
  const persistence = new FakePersistence();
  let confirmCalls = 0;
  const capturedDraftNotes = [];

  manager.persistence = persistence;
  manager.createDraft = async (input) => {
    capturedDraftNotes.push(String(input?.notes || ""));
    return makeDraft(manager, input, confirmCalls + 1);
  };
  manager.confirmAndRun = async () => {
    confirmCalls += 1;
    return {
      run: {
        runId: `local_run_${confirmCalls}`,
        status: "pass",
        summary: "All checks passed.",
        steps: [{ action: "goto" }, { action: "click" }, { action: "assertVisible" }],
        artifacts: [],
        videoPath: null,
        semantics: { overallPass: true },
        critique: { issues: [] }
      }
    };
  };

  const prepared = await manager.orchestrateTask({
    projectName: "Approval Test Project",
    url: "http://127.0.0.1/test",
    task: "Prepare run and wait for approval",
    notes: "approval gate test",
    additions: "",
    skipCodex: true
  });

  assert.equal(prepared.awaitingApproval, true, "Expected orchestrateTask to stop at the approval checkpoint");
  assert.equal(prepared.run.status, "to_be_approved", "Run should be stored as awaiting approval");
  assert.equal(confirmCalls, 0, "Execution should not start before approval");

  const awaitingApproval = await manager.listAwaitingApprovalRuns();
  assert.equal(awaitingApproval.length, 1, "Expected run to appear in approval queue");

  const editedInstructions = "Edited approval instructions: scroll full page, click launch CTA, verify timeline cards.";
  await manager.updateRunTestingInstructions({
    runId: prepared.run.id,
    testingInstructions: editedInstructions,
    editedBy: "tester"
  });

  await manager.approveRun({ runId: prepared.run.id, approvedBy: "tester" });
  await manager.processApprovedRuns();

  const detail = await waitForRunStatus(manager, prepared.run.id, "passed");
  assert.equal(detail.status, "passed", "Approved run should complete");
  assert.equal(detail.approvedBy, "tester", "Expected approver to be stored");
  assert.equal(detail.testingInstructions, editedInstructions, "Expected edited instructions to persist");
  assert.equal(detail.loopIterations.length, 1, "Expected one loop iteration");
  assert.equal(confirmCalls, 1, "Expected exactly one execution after approval");
  assert.equal(
    capturedDraftNotes.some((notes, index) => index > 0 && notes.includes(editedInstructions)),
    true,
    "Expected resumed orchestration draft generation to include edited instructions"
  );
}

async function runMaxLoopCapTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-approval-max-"));
  const manager = new AgenticLoopManager(tmp);
  const persistence = new FakePersistence();
  let confirmCalls = 0;

  manager.persistence = persistence;
  manager.createDraft = async (input) => makeDraft(manager, input, confirmCalls + 1);
  manager.confirmAndRun = async () => {
    confirmCalls += 1;
    return {
      run: {
        runId: `local_run_fail_${confirmCalls}`,
        status: "fail",
        summary: `Loop ${confirmCalls} failed quality gate.`,
        steps: [{ action: "goto" }, { action: "assertVisible" }],
        artifacts: [],
        videoPath: null,
        semantics: { overallPass: false },
        critique: { issues: [{ description: `Issue ${confirmCalls}` }] }
      }
    };
  };

  const prepared = await manager.orchestrateTask({
    projectName: "Approval Max Loop Project",
    url: "http://127.0.0.1/test",
    task: "Retry until max loops reached",
    notes: "max loop approval gate test",
    additions: "",
    skipCodex: true
  });

  await manager.approveRun({ runId: prepared.run.id, approvedBy: "tester" });
  await manager.processApprovedRuns();

  const detail = await waitForRunStatus(manager, prepared.run.id, "max_loops_reached");
  assert.equal(detail.status, "max_loops_reached", "Expected execution to stop at the max loop cap");
  assert.equal(detail.loopCount, 3, "Expected exactly three persisted loops");
  assert.equal(detail.loopIterations.length, 3, "Expected three loop iteration records");
  assert.equal(confirmCalls, 3, "Expected exactly three execution attempts");
}

async function runVariantFromHistoricalRunTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-approval-variant-"));
  const manager = new AgenticLoopManager(tmp);
  const persistence = new FakePersistence();
  const capturedDraftInputs = [];
  let confirmCalls = 0;

  manager.persistence = persistence;
  manager.createDraft = async (input) => {
    capturedDraftInputs.push({
      notes: String(input?.notes || ""),
      objective: String(input?.objective || ""),
      url: String(input?.url || "")
    });
    return makeDraft(manager, input, confirmCalls + 1);
  };
  manager.confirmAndRun = async () => {
    confirmCalls += 1;
    return {
      run: {
        runId: `variant_run_${confirmCalls}`,
        status: "pass",
        summary: "Variant checks passed.",
        steps: [{ action: "goto" }, { action: "click" }, { action: "assertVisible" }],
        artifacts: [],
        videoPath: null,
        semantics: { overallPass: true },
        critique: { issues: [] }
      }
    };
  };

  const project = await persistence.getOrCreateProjectByName("Approval Test Project");
  const sourceInstructions = [
    "Objective: Validate historical portfolio flow",
    "Target URL: http://127.0.0.1/test",
    "Notes: Start from the hero section and validate the main timeline CTA.",
    "Planned Steps:",
    "1. goto http://127.0.0.1/test",
    "2. click text=Launch",
    "3. assertVisible text=Ready"
  ].join("\n\n");
  const sourceRun = await persistence.createDraftingRun({
    projectId: project.id,
    testingInstructions: sourceInstructions,
    threePointSummary: ensureSummaryArray([
      "Historical source run persisted.",
      "This run has no draft payload.",
      "Use it to seed a variant."
    ]),
    draftPayload: null
  });
  await persistence.finalizeRun({
    testRunId: sourceRun.id,
    executionTimeMs: 25,
    loopCount: 1,
    status: "passed",
    testingInstructions: sourceInstructions,
    videoReference: null,
    threePointSummary: ensureSummaryArray([
      "Historical source run passed.",
      "Stored for variant cloning.",
      "Execution complete."
    ]),
    lastErrorText: null
  });

  const variantRun = await manager.createVariantRun({
    sourceRunId: sourceRun.id
  });
  assert.equal(variantRun.status, "to_be_approved", "Expected historical variant to enter the approval queue");
  assert.equal(variantRun.testingInstructions, sourceInstructions, "Expected variant to copy source instructions");
  assert.equal(confirmCalls, 0, "Variant creation must not execute before approval");

  await manager.approveRun({
    runId: variantRun.id,
    approvedBy: "tester",
    testingInstructions: `${sourceInstructions}\n\nAdditions: Variant focuses on Black Box state as well.`
  });
  await manager.processApprovedRuns();

  const detail = await waitForRunStatus(manager, variantRun.id, "passed");
  assert.equal(detail.status, "passed", "Variant should resume and complete from persisted instructions");
  assert.equal(confirmCalls, 1, "Variant should execute once after approval");
  assert.equal(capturedDraftInputs.length, 1, "Variant should regenerate a fresh draft from stored instructions");
  assert.equal(capturedDraftInputs[0].objective, "Validate historical portfolio flow", "Expected objective to be reconstructed from instructions");
  assert.equal(capturedDraftInputs[0].url, "http://127.0.0.1/test", "Expected url to be reconstructed from instructions");
  assert.equal(
    capturedDraftInputs[0].notes.includes("Approved testing instructions:"),
    true,
    "Expected regenerated draft to include persisted approved instructions"
  );
}

async function run() {
  await runApprovalResumeTest();
  await runMaxLoopCapTest();
  await runVariantFromHistoricalRunTest();
  console.log("agentic_approval_gating.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
