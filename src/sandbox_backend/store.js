const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

class SandboxBackendStore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dbDir = path.join(projectRoot, "db");
    this.dbPath = path.join(this.dbDir, "sandbox_backend.json");
    this.artifactsDir = path.join(this.dbDir, "sandbox_artifacts");

    ensureDir(this.dbDir);
    ensureDir(this.artifactsDir);

    if (!fs.existsSync(this.dbPath)) {
      this.write(this.emptyDb());
    }
  }

  emptyDb() {
    return {
      schemaVersion: "1.0.0",
      projects: [],
      forests: [],
      scenarios: [],
      environmentVersions: [],
      runs: [],
      runSteps: [],
      artifacts: [],
      stateSnapshots: [],
      comparisons: []
    };
  }

  read() {
    return JSON.parse(fs.readFileSync(this.dbPath, "utf8"));
  }

  write(db) {
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }

  makeId(prefix) {
    return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }

  insert(collectionName, entity) {
    const db = this.read();
    db[collectionName].unshift(entity);
    this.write(db);
    return entity;
  }

  update(collectionName, idField, idValue, updater) {
    const db = this.read();
    const idx = db[collectionName].findIndex((item) => item[idField] === idValue);
    if (idx < 0) return null;
    const next = updater({ ...db[collectionName][idx] });
    db[collectionName][idx] = next;
    this.write(db);
    return next;
  }

  upsertBy(collectionName, matcher, producer) {
    const db = this.read();
    const idx = db[collectionName].findIndex(matcher);
    if (idx < 0) {
      const next = producer(null);
      db[collectionName].unshift(next);
      this.write(db);
      return next;
    }

    const next = producer({ ...db[collectionName][idx] });
    db[collectionName][idx] = next;
    this.write(db);
    return next;
  }

  findById(collectionName, idField, idValue) {
    return this.read()[collectionName].find((item) => item[idField] === idValue) || null;
  }

  list(collectionName, filterFn = null) {
    const rows = this.read()[collectionName];
    return filterFn ? rows.filter(filterFn) : rows;
  }
}

module.exports = {
  SandboxBackendStore,
  nowIso
};
