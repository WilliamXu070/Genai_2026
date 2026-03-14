const path = require("node:path");
const { RunStore } = require("./store");
const { executeScenario } = require("./runner");

class JungleManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.store = new RunStore(projectRoot);
    this.activeRuns = new Map();
  }

  listRuns(limit = 20) {
    return this.store.listRuns(limit);
  }

  async startRun(input, emitEvent) {
    const normalized = {
      projectName: input.projectName || "Jungle",
      scenarioName: input.scenarioName || "MVP scenario",
      command: typeof input.command === "string" ? input.command : "",
      cwd: input.cwd || this.projectRoot,
      url: input.url || "http://127.0.0.1:3000",
      perturbationProfile: input.perturbationProfile || "none",
      steps: input.steps || []
    };

    const { run, runPath } = this.store.createRun(normalized);

    this.store.updateRun(run.runId, (draft) => ({
      ...draft,
      startedAt: new Date().toISOString(),
      status: "running"
    }));

    this.activeRuns.set(run.runId, { startedAt: Date.now() });
    emitEvent({ type: "run_started", runId: run.runId });

    const result = await executeScenario({
      input: normalized,
      runPath,
      emitEvent
    });

    const finalRun = this.store.updateRun(run.runId, (draft) => ({
      ...draft,
      artifacts: result.artifacts,
      endedAt: result.endedAt,
      failedStep: result.failedStep,
      resultSummary: result.resultSummary,
      startedAt: result.startedAt,
      status: result.status,
      steps: result.steps
    }));

    this.activeRuns.delete(run.runId);
    emitEvent({ type: "run_finished", run: finalRun });

    return finalRun;
  }

  getTodoBlueprint() {
    return {
      completed: [
        "Run creation + persistence",
        "App readiness check",
        "Step execution pipeline (MVP deterministic runner)",
        "Artifact bundle writing",
        "Run history retrieval"
      ],
      blankBoxes: [
        "[ ] Full Playwright executor with screenshot/video/trace",
        "[ ] Perturbation profile engine (slow network, expired auth)",
        "[ ] Forest/Tree advanced navigation",
        "[ ] Langflow MCP integration wiring",
        "[ ] Cross-run diff visualization"
      ]
    };
  }
}

module.exports = {
  JungleManager
};
