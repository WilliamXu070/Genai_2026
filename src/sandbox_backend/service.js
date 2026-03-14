const { SandboxBackendStore, nowIso } = require("./store");

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
}

class SandboxBackendService {
  constructor(projectRoot) {
    this.store = new SandboxBackendStore(projectRoot);
  }

  createProject(input) {
    required(input?.name, "name");
    const project = {
      projectId: this.store.makeId("project"),
      name: input.name,
      repoPath: input.repoPath || null,
      defaultBranch: input.defaultBranch || "main",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    return this.store.insert("projects", project);
  }

  createForestTemplate(input) {
    required(input?.projectId, "projectId");
    required(input?.name, "name");
    required(input?.baseRuntimeImage, "baseRuntimeImage");
    required(input?.startCommand, "startCommand");
    required(input?.baseUrl, "baseUrl");

    this.mustExist("projects", "projectId", input.projectId);

    const forest = {
      forestId: this.store.makeId("forest"),
      projectId: input.projectId,
      name: input.name,
      baseRuntimeImage: input.baseRuntimeImage,
      services: input.services || [],
      startCommand: input.startCommand,
      baseUrl: input.baseUrl,
      healthCheck: input.healthCheck || { type: "http", path: "/" },
      supportedPerturbations: input.supportedPerturbations || ["none"],
      observability: input.observability || ["console", "network", "trace", "video"],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    return this.store.insert("forests", forest);
  }

  createScenario(input) {
    required(input?.projectId, "projectId");
    required(input?.name, "name");
    required(input?.planJson, "planJson");

    this.mustExist("projects", "projectId", input.projectId);

    const scenario = {
      scenarioId: this.store.makeId("scenario"),
      projectId: input.projectId,
      name: input.name,
      planJson: input.planJson,
      parserVersion: input.parserVersion || "v1",
      executorVersion: input.executorVersion || "v1",
      metadata: input.metadata || {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    return this.store.insert("scenarios", scenario);
  }

  createEnvironmentVersion(input) {
    required(input?.projectId, "projectId");
    required(input?.forestId, "forestId");
    required(input?.label, "label");
    required(input?.dockerImageDigest, "dockerImageDigest");

    this.mustExist("projects", "projectId", input.projectId);
    this.mustExist("forests", "forestId", input.forestId);

    if (input.parentEnvironmentVersionId) {
      this.mustExist("environmentVersions", "environmentVersionId", input.parentEnvironmentVersionId);
    }

    const envVersion = {
      environmentVersionId: this.store.makeId("env"),
      projectId: input.projectId,
      forestId: input.forestId,
      parentEnvironmentVersionId: input.parentEnvironmentVersionId || null,
      label: input.label,
      gitCommit: input.gitCommit || null,
      dirtyPatchRef: input.dirtyPatchRef || null,
      lockfileHash: input.lockfileHash || null,
      dockerImageDigest: input.dockerImageDigest,
      envFingerprint: input.envFingerprint || {},
      ports: input.ports || [],
      workingDir: input.workingDir || null,
      startupCommand: input.startupCommand || null,
      baseUrl: input.baseUrl || null,
      notes: input.notes || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    return this.store.insert("environmentVersions", envVersion);
  }

  startRun(input) {
    required(input?.projectId, "projectId");
    required(input?.forestId, "forestId");
    required(input?.scenarioId, "scenarioId");
    required(input?.environmentVersionId, "environmentVersionId");

    this.mustExist("projects", "projectId", input.projectId);
    this.mustExist("forests", "forestId", input.forestId);
    this.mustExist("scenarios", "scenarioId", input.scenarioId);
    this.mustExist("environmentVersions", "environmentVersionId", input.environmentVersionId);

    if (input.parentRunId) {
      this.mustExist("runs", "runId", input.parentRunId);
    }

    const run = {
      runId: this.store.makeId("run"),
      projectId: input.projectId,
      forestId: input.forestId,
      scenarioId: input.scenarioId,
      environmentVersionId: input.environmentVersionId,
      parentRunId: input.parentRunId || null,
      runType: input.runType || "new",
      branchName: input.branchName || "main",
      perturbationProfile: input.perturbationProfile || "none",
      source: input.source || "mcp",
      requestInput: input.requestInput || {},
      status: "starting",
      startedAt: nowIso(),
      endedAt: null,
      failedStep: null,
      resultSummary: null,
      consoleErrors: [],
      networkFailures: [],
      metrics: {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    return this.store.insert("runs", run);
  }

  recordRunStep(input) {
    required(input?.runId, "runId");
    required(input?.stepIndex, "stepIndex");
    required(input?.action, "action");

    this.mustExist("runs", "runId", input.runId);

    return this.store.upsertBy(
      "runSteps",
      (row) => row.runId === input.runId && row.stepIndex === input.stepIndex,
      (existing) => ({
        stepId: existing?.stepId || this.store.makeId("step"),
        runId: input.runId,
        stepIndex: input.stepIndex,
        action: input.action,
        target: input.target || null,
        status: input.status || "pending",
        note: input.note || null,
        startedAt: input.startedAt || existing?.startedAt || nowIso(),
        endedAt: input.endedAt || null,
        durationMs: input.durationMs || null,
        updatedAt: nowIso(),
        createdAt: existing?.createdAt || nowIso()
      })
    );
  }

  recordArtifact(input) {
    required(input?.runId, "runId");
    required(input?.type, "type");
    required(input?.path, "path");

    this.mustExist("runs", "runId", input.runId);

    const artifact = {
      artifactId: this.store.makeId("artifact"),
      runId: input.runId,
      type: input.type,
      path: input.path,
      metadata: input.metadata || {},
      createdAt: nowIso()
    };

    return this.store.insert("artifacts", artifact);
  }

  captureStateSnapshot(input) {
    required(input?.runId, "runId");
    this.mustExist("runs", "runId", input.runId);

    return this.store.upsertBy(
      "stateSnapshots",
      (row) => row.runId === input.runId,
      (existing) => ({
        snapshotId: existing?.snapshotId || this.store.makeId("snapshot"),
        runId: input.runId,
        dbSnapshotRef: input.dbSnapshotRef || existing?.dbSnapshotRef || null,
        authSnapshotRef: input.authSnapshotRef || existing?.authSnapshotRef || null,
        fsSnapshotRef: input.fsSnapshotRef || existing?.fsSnapshotRef || null,
        envResolved: input.envResolved || existing?.envResolved || {},
        hotloadTier: input.hotloadTier || existing?.hotloadTier || "full",
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso()
      })
    );
  }

  completeRun(input) {
    required(input?.runId, "runId");
    required(input?.status, "status");

    const run = this.store.update("runs", "runId", input.runId, (draft) => ({
      ...draft,
      status: input.status,
      resultSummary: input.resultSummary || draft.resultSummary,
      failedStep: input.failedStep ?? draft.failedStep,
      consoleErrors: input.consoleErrors || draft.consoleErrors,
      networkFailures: input.networkFailures || draft.networkFailures,
      metrics: input.metrics || draft.metrics,
      endedAt: nowIso(),
      updatedAt: nowIso()
    }));

    if (!run) {
      throw new Error("run not found");
    }

    return run;
  }

  redoPreviousTest(input) {
    required(input?.runId, "runId");
    const base = this.mustExist("runs", "runId", input.runId);

    return this.startRun({
      projectId: base.projectId,
      forestId: base.forestId,
      scenarioId: base.scenarioId,
      environmentVersionId: base.environmentVersionId,
      parentRunId: base.runId,
      runType: "redo",
      branchName: base.branchName,
      perturbationProfile: input.perturbationProfile || base.perturbationProfile,
      source: input.source || "ui-rerun",
      requestInput: {
        replayOf: base.runId,
        reason: input.reason || "Redo previous test"
      }
    });
  }

  branchFromPreviousRun(input) {
    required(input?.runId, "runId");
    required(input?.branchName, "branchName");

    const base = this.mustExist("runs", "runId", input.runId);
    const scenarioId = input.scenarioId || base.scenarioId;
    this.mustExist("scenarios", "scenarioId", scenarioId);

    return this.startRun({
      projectId: base.projectId,
      forestId: base.forestId,
      scenarioId,
      environmentVersionId: base.environmentVersionId,
      parentRunId: base.runId,
      runType: "branch",
      branchName: input.branchName,
      perturbationProfile: input.perturbationProfile || base.perturbationProfile,
      source: input.source || "ui-branch",
      requestInput: {
        branchFromRunId: base.runId,
        reason: input.reason || "Branch from previous run"
      }
    });
  }

  getRun(runId) {
    const run = this.mustExist("runs", "runId", runId);
    return {
      ...run,
      scenario: this.store.findById("scenarios", "scenarioId", run.scenarioId),
      environmentVersion: this.store.findById("environmentVersions", "environmentVersionId", run.environmentVersionId),
      steps: this.store.list("runSteps", (step) => step.runId === runId).sort((a, b) => a.stepIndex - b.stepIndex),
      artifacts: this.store.list("artifacts", (artifact) => artifact.runId === runId),
      stateSnapshot: this.store.list("stateSnapshots", (snapshot) => snapshot.runId === runId)[0] || null
    };
  }

  listRuns(input = {}) {
    const limit = input.limit || 50;
    return this.store
      .list("runs", (run) => {
        if (input.projectId && run.projectId !== input.projectId) return false;
        if (input.forestId && run.forestId !== input.forestId) return false;
        if (input.status && run.status !== input.status) return false;
        if (input.branchName && run.branchName !== input.branchName) return false;
        if (input.parentRunId && run.parentRunId !== input.parentRunId) return false;
        return true;
      })
      .slice(0, limit);
  }

  getNavigableRuntimeMemory(input = {}) {
    const runs = this.listRuns({ projectId: input.projectId, forestId: input.forestId, limit: 1000 });
    const nodes = runs.map((run) => ({
      runId: run.runId,
      parentRunId: run.parentRunId,
      branchName: run.branchName,
      runType: run.runType,
      status: run.status,
      scenarioId: run.scenarioId,
      environmentVersionId: run.environmentVersionId,
      createdAt: run.createdAt
    }));

    const edges = nodes
      .filter((node) => node.parentRunId)
      .map((node) => ({ fromRunId: node.parentRunId, toRunId: node.runId }));

    const scenariosById = Object.fromEntries(
      this.store.list("scenarios").map((scenario) => [scenario.scenarioId, scenario.name])
    );

    return { nodes, edges, scenariosById };
  }

  getHotloadBundle(input) {
    required(input?.runId, "runId");
    const mode = input.mode || "full";
    const run = this.getRun(input.runId);
    const snapshot = run.stateSnapshot;

    return {
      runId: run.runId,
      mode,
      bootstrap: {
        dockerImageDigest: run.environmentVersion?.dockerImageDigest || null,
        startCommand: run.environmentVersion?.startupCommand || null,
        baseUrl: run.environmentVersion?.baseUrl || null,
        perturbationProfile: run.perturbationProfile,
        scenarioPlan: run.scenario?.planJson || null
      },
      restore: mode === "quick"
        ? {
            dbSnapshotRef: null,
            authSnapshotRef: null,
            fsSnapshotRef: snapshot?.fsSnapshotRef || null
          }
        : {
            dbSnapshotRef: snapshot?.dbSnapshotRef || null,
            authSnapshotRef: snapshot?.authSnapshotRef || null,
            fsSnapshotRef: snapshot?.fsSnapshotRef || null
          }
    };
  }

  compareRuns(input) {
    required(input?.baseRunId, "baseRunId");
    required(input?.candidateRunId, "candidateRunId");

    const base = this.getRun(input.baseRunId);
    const candidate = this.getRun(input.candidateRunId);

    const diff = {
      statusChanged: base.status !== candidate.status,
      baseStatus: base.status,
      candidateStatus: candidate.status,
      failedStepChanged: base.failedStep !== candidate.failedStep,
      baseFailedStep: base.failedStep,
      candidateFailedStep: candidate.failedStep,
      perturbationChanged: base.perturbationProfile !== candidate.perturbationProfile,
      basePerturbation: base.perturbationProfile,
      candidatePerturbation: candidate.perturbationProfile,
      consoleErrorDelta: (candidate.consoleErrors?.length || 0) - (base.consoleErrors?.length || 0),
      networkFailureDelta: (candidate.networkFailures?.length || 0) - (base.networkFailures?.length || 0)
    };

    const record = {
      comparisonId: this.store.makeId("compare"),
      baseRunId: base.runId,
      candidateRunId: candidate.runId,
      diff,
      createdAt: nowIso()
    };

    this.store.insert("comparisons", record);
    return record;
  }

  mustExist(collection, idField, idValue) {
    const row = this.store.findById(collection, idField, idValue);
    if (!row) {
      throw new Error(`${collection} not found: ${idValue}`);
    }
    return row;
  }
}

module.exports = {
  SandboxBackendService
};
