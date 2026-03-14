const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

class RunStore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dbDir = path.join(projectRoot, "db");
    this.runsDir = path.join(this.dbDir, "runs");
    this.dbPath = path.join(this.dbDir, "runs.json");
    ensureDir(this.runsDir);

    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(
        this.dbPath,
        JSON.stringify({ schemaVersion: "0.1.0", runs: [] }, null, 2),
        "utf8"
      );
    }
  }

  readDb() {
    return JSON.parse(fs.readFileSync(this.dbPath, "utf8"));
  }

  writeDb(db) {
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }

  createRun(input) {
    const db = this.readDb();
    const runId = `run_${Date.now()}`;
    const runPath = path.join(this.runsDir, runId);
    ensureDir(runPath);

    const run = {
      runId,
      projectName: input.projectName || "Jungle Project",
      scenarioName: input.scenarioName || "MVP scenario",
      status: "starting",
      command: input.command || "npm start",
      url: input.url || "http://127.0.0.1:3000",
      perturbationProfile: input.perturbationProfile || "none",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      endedAt: null,
      resultSummary: null,
      failedStep: null,
      artifacts: [],
      steps: []
    };

    db.runs.unshift(run);
    this.writeDb(db);

    return { run, runPath };
  }

  updateRun(runId, updater) {
    const db = this.readDb();
    const idx = db.runs.findIndex((r) => r.runId === runId);
    if (idx < 0) {
      return null;
    }

    const next = updater({ ...db.runs[idx] });
    next.updatedAt = nowIso();
    db.runs[idx] = next;
    this.writeDb(db);
    return next;
  }

  listRuns(limit = 20) {
    const db = this.readDb();
    return db.runs.slice(0, limit);
  }
}

module.exports = {
  RunStore
};
