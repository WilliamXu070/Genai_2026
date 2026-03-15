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
      previewType: null,
      previewPath: null,
      previewTitle: null,
      threePointSummary: ensureSummaryArray(input.threePointSummary),
      lastErrorText: null,
      approvalRequestedAt: null,
      approvedAt: null,
      approvedBy: null,
      cancelledAt: null,
      draftPayload: input.draftPayload || null,
      semanticVerdict: null,
      semanticInterpretation: null,
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
    run.status = "failed_execution";
    run.lastErrorText = input.lastErrorText || "draft failure";
    run.threePointSummary = ensureSummaryArray(input.threePointSummary);
    run.draftPayload = clone(input.draftPayload || run.draftPayload || null);
    run.semanticVerdict = input.semanticVerdict || null;
    run.semanticInterpretation = clone(input.semanticInterpretation || null);
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

  async updateRunPreview(input) {
    const run = this.runs.get(input.runId);
    if (!run) {
      return null;
    }
    run.previewPath = typeof input.previewPath === "string" && input.previewPath.trim() ? input.previewPath.trim() : null;
    run.previewTitle = typeof input.previewTitle === "string" && input.previewTitle.trim() ? input.previewTitle.trim() : null;
    run.previewType = typeof input.previewType === "string" && input.previewType.trim() ? input.previewType.trim() : null;
    run.updatedAt = nowIso();
    this.project.updatedAt = nowIso();
    return clone(run);
  }

  async cancelRun(input) {
    const run = this.runs.get(input.runId);
    if (!run) {
      return null;
    }
    if (run.draftPayload?.sourceRunId && ["drafting", "to_be_approved", "approved"].includes(run.status) && Number(run.loopCount || 0) === 0) {
      this.runs.delete(input.runId);
      this.loopIterations.delete(input.runId);
      this.project.updatedAt = nowIso();
      return {
        ...clone(run),
        deleted: true,
        status: "deleted"
      };
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
      ["drafting", "to_be_approved", "approved", "in_progress", "completed", "failed_execution", "cancelled"],
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
    run.previewType = input.previewType || run.previewType || null;
    run.previewPath = input.previewPath || run.previewPath || null;
    run.previewTitle = input.previewTitle || run.previewTitle || null;
    run.threePointSummary = ensureSummaryArray(input.threePointSummary);
    run.lastErrorText = input.lastErrorText || null;
    run.draftPayload = clone(input.draftPayload || run.draftPayload || null);
    run.semanticVerdict = input.semanticVerdict || run.semanticVerdict || null;
    run.semanticInterpretation = clone(input.semanticInterpretation || run.semanticInterpretation || null);
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

  const detail = await waitForRunStatus(manager, prepared.run.id, "completed");
  assert.equal(detail.status, "completed", "Approved run should complete");
  assert.equal(detail.approvedBy, "tester", "Expected approver to be stored");
  assert.equal(detail.testingInstructions, editedInstructions, "Expected edited instructions to persist");
  assert.equal(detail.loopIterations.length, 1, "Expected one loop iteration");
  assert.equal(detail.semanticVerdict, "strong", "Expected semantic verdict to replace test pass/fail");
  assert.ok(detail.semanticInterpretation, "Expected semantic interpretation to be stored");
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

  const detail = await waitForRunStatus(manager, prepared.run.id, "completed");
  assert.equal(detail.status, "completed", "Expected execution to complete with semantic findings after the max loop cap");
  assert.equal(detail.loopCount, 3, "Expected exactly three persisted loops");
  assert.equal(detail.loopIterations.length, 3, "Expected three loop iteration records");
  assert.equal(detail.semanticVerdict, "mixed", "Expected a semantic verdict instead of max-loop failure status");
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
    status: "completed",
    testingInstructions: sourceInstructions,
    videoReference: null,
    threePointSummary: ensureSummaryArray([
      "Historical source run completed.",
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

  const detail = await waitForRunStatus(manager, variantRun.id, "completed");
  assert.equal(detail.status, "completed", "Variant should resume and complete from persisted instructions");
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

async function runCancelledVariantDeletionTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-approval-variant-cancel-"));
  const manager = new AgenticLoopManager(tmp);
  const persistence = new FakePersistence();
  manager.persistence = persistence;

  const project = await persistence.getOrCreateProjectByName("Approval Test Project");
  const sourceInstructions = [
    "Objective: Validate historical portfolio flow",
    "Target Type: web_frontend",
    "Target: http://127.0.0.1/test",
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
    status: "completed",
    testingInstructions: sourceInstructions,
    videoReference: null,
    threePointSummary: ensureSummaryArray([
      "Historical source run completed.",
      "Stored for variant cloning.",
      "Execution complete."
    ]),
    lastErrorText: null
  });

  const variantRun = await manager.createVariantRun({
    sourceRunId: sourceRun.id
  });
  assert.equal(variantRun.status, "to_be_approved");

  const cancelled = await manager.cancelRun({
    runId: variantRun.id,
    reason: "User abandoned variant draft."
  });
  assert.equal(cancelled.deleted, true, "Expected cancelled variant draft to be deleted");

  const detail = await manager.getProjectTestRun(variantRun.id);
  assert.equal(detail, null, "Deleted variant should not be retrievable");

  const projectRuns = await manager.listProjectTestRuns(project.id);
  assert.equal(
    projectRuns.some((run) => run.id === variantRun.id),
    false,
    "Deleted variant should not appear in project history"
  );

  const approvalRuns = await manager.listAwaitingApprovalRuns(project.id);
  assert.equal(
    approvalRuns.some((run) => run.id === variantRun.id),
    false,
    "Deleted variant should not appear in approval queue"
  );
}

async function runPreviewMetadataPersistenceTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-run-preview-"));
  const manager = new AgenticLoopManager(tmp);
  const persistence = new FakePersistence();
  manager.persistence = persistence;

  const project = await persistence.getOrCreateProjectByName("Preview Project");
  const run = await persistence.createDraftingRun({
    projectId: project.id,
    testingInstructions: "Preview run",
    threePointSummary: ensureSummaryArray([
      "Preview save started.",
      "Attach a static preview path.",
      "Open from the UI later."
    ]),
    draftPayload: null
  });

  const updated = await manager.updateRunPreview({
    runId: run.id,
    previewType: "static_html",
    previewPath: "C:\\previews\\v1\\index.html",
    previewTitle: "Landing Preview"
  });

  assert.equal(updated.previewType, "static_html");
  assert.equal(updated.previewPath, "C:\\previews\\v1\\index.html");
  assert.equal(updated.previewTitle, "Landing Preview");

  const detail = await manager.getProjectTestRun(run.id);
  assert.equal(detail.previewType, "static_html");
  assert.equal(detail.previewPath, "C:\\previews\\v1\\index.html");
  assert.equal(detail.previewTitle, "Landing Preview");
}

async function runFeatureFailureInterpretationTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-failure-interpretation-"));
  const manager = new AgenticLoopManager(tmp);
  const persistence = new FakePersistence();
  let confirmCalls = 0;

  manager.persistence = persistence;
  manager.createDraft = async (input) => makeDraft(manager, input, confirmCalls + 1);
  manager.confirmAndRun = async () => {
    confirmCalls += 1;
    return {
      run: {
        runId: `feature_failure_${confirmCalls}`,
        status: "fail",
        summary: "Mark as complete updated the counters but the task card still rendered as In progress.",
        steps: [
          { action: "goto", status: "pass" },
          {
            action: "click",
            status: "fail",
            note: "After clicking Mark as complete, the card badge and visual state did not switch to completed."
          }
        ],
        artifacts: [],
        videoPath: null,
        semantics: {
          overallPass: false,
          verdict: "fail",
          wrong: [
            "run_summary: Mark as complete updated the counters but the task card still rendered as In progress.",
            "failed_step_note: After clicking Mark as complete, the card badge and visual state did not switch to completed.",
            "run_status_consistent: status=fail failedSteps=1"
          ]
        },
        critique: {
          issues: [
            {
              severity: "high",
              description: "The complete-task feature leaves the visible task card in the wrong UI state.",
              evidence: "Counts changed, but the card badge still said In progress after completion.",
              fix: "Bind the completed state to the card badge, card styling, and button label in the React view."
            }
          ]
        }
      }
    };
  };

  const prepared = await manager.orchestrateTask({
    projectName: "Failure Interpretation Project",
    url: "http://127.0.0.1/test",
    task: "Test the complete-task flow and fail if the visible card state does not update.",
    notes: "Focus on feature-level UI correctness.",
    additions: "",
    skipCodex: true
  });

  await manager.approveRun({ runId: prepared.run.id, approvedBy: "tester" });
  await manager.processApprovedRuns();

  const detail = await waitForRunStatus(manager, prepared.run.id, "completed");
  assert.equal(detail.status, "completed");
  assert.equal(confirmCalls, 3, "Expected loop execution to stop at the hard cap");
  assert.ok(detail.semanticInterpretation, "Expected semantic interpretation to be persisted");
  assert.ok(
    Array.isArray(detail.semanticInterpretation.failedItems) &&
      detail.semanticInterpretation.failedItems.length >= 1,
    "Expected semantic failure items to be generated"
  );
  assert.equal(
    detail.semanticInterpretation.summary.includes("feature") || detail.semanticInterpretation.failedItems.some((bullet) => /feature|state|task card/i.test(bullet)),
    true,
    "Expected development-facing semantic interpretation"
  );
  assert.equal(
    JSON.stringify(detail.semanticInterpretation).match(/Mark as complete|completed/i) !== null,
    true,
    "Expected the feature-specific failure to be reflected in the bullets"
  );
}

async function run() {
  await runApprovalResumeTest();
  await runMaxLoopCapTest();
  await runVariantFromHistoricalRunTest();
  await runCancelledVariantDeletionTest();
  await runPreviewMetadataPersistenceTest();
  await runFeatureFailureInterpretationTest();
  console.log("agentic_approval_gating.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
