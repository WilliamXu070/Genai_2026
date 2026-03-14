const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function asTitle(value) {
  const text = (value || "").trim();
  if (!text) {
    return "Untitled test";
  }
  const sentence = text.split(".")[0] || text;
  return sentence.slice(0, 96);
}

function sortByNewest(items, field) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a[field] || 0);
    const right = Date.parse(b[field] || 0);
    return right - left;
  });
}

class CatalogService {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dbDir = path.join(projectRoot, "db");
    this.catalogPath = path.join(this.dbDir, "test_catalog.json");
    this.langflowRunsDir = path.join(this.dbDir, "langflow_agentic_runs");
    this.state = null;
  }

  ensureLoaded() {
    if (this.state) {
      return;
    }

    if (fs.existsSync(this.catalogPath)) {
      this.state = readJson(this.catalogPath);
      return;
    }

    this.state = this.createSeedState();
    this.persist();
  }

  createSeedState() {
    const generatedAt = nowIso();
    const tests = [];
    const imported = this.importLangflowRuns();
    tests.push(...imported);

    const starter = [
      {
        objective: "Verify landing page loads and shows main heading.",
        status: "pending_approval",
        notes: "Starter manual test created by Jungle catalog seeder."
      },
      {
        objective: "Validate terminal output panel renders latest command logs.",
        status: "approved",
        notes: "Starter manual test created by Jungle catalog seeder."
      },
      {
        objective: "Confirm video artifact is available in results view for a selected run.",
        status: "needs_changes",
        notes: "Starter manual test created by Jungle catalog seeder."
      }
    ];

    starter.forEach((item, index) => {
      const testId = `manual_seed_${index + 1}`;
      tests.push({
        id: testId,
        title: asTitle(item.objective),
        status: item.status,
        createdAt: generatedAt,
        updatedAt: generatedAt,
        objective: item.objective,
        latestVersion: 1,
        versions: [
          {
            id: `${testId}_v1`,
            number: 1,
            objective: item.objective,
            notes: item.notes,
            status: item.status,
            sourceType: "manual_seed",
            plan: {
              steps: [
                { action: "goto", target: "/" },
                { action: "assertVisible", target: "main heading" }
              ]
            },
            createdAt: generatedAt
          }
        ],
        runs: []
      });
    });

    return {
      meta: {
        generatedAt,
        source: "file",
        langflowRunsDir: this.langflowRunsDir,
        projectRoot: this.projectRoot
      },
      tests: sortByNewest(tests, "updatedAt")
    };
  }

  importLangflowRuns() {
    if (!fs.existsSync(this.langflowRunsDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.langflowRunsDir)
      .filter((name) => name.startsWith("orchestration_") && name.endsWith(".json"))
      .sort();

    return files.map((fileName) => {
      const filePath = path.join(this.langflowRunsDir, fileName);
      const raw = readJson(filePath);
      const createdAt = nowIso();
      const objective = raw?.plan?.objective || "Imported Langflow run";
      const title = asTitle(objective);
      const runId = fileName.replace(".json", "");
      const status = raw?.execution?.status || "unknown";
      const mappedStatus =
        status === "pass" ? "approved" : status === "fail" ? "needs_changes" : "pending_approval";

      return {
        id: `langflow_${runId}`,
        title,
        status: mappedStatus,
        createdAt,
        updatedAt: createdAt,
        objective,
        latestVersion: 1,
        versions: [
          {
            id: `langflow_${runId}_v1`,
            number: 1,
            objective,
            notes: raw?.execution?.summary || "Imported from langflow agentic run.",
            status: mappedStatus,
            sourceType: "langflow_import",
            plan: raw?.plan || {},
            createdAt
          }
        ],
        runs: [
          {
            id: runId,
            status,
            summary: raw?.execution?.summary || "",
            videoPath: raw?.execution?.video_path || "",
            artifacts: raw?.execution?.artifacts || [],
            sourceFile: filePath,
            createdAt
          }
        ]
      };
    });
  }

  persist() {
    fs.mkdirSync(this.dbDir, { recursive: true });
    writeJson(this.catalogPath, this.state);
  }

  listTests() {
    this.ensureLoaded();
    return this.state.tests.map((test) => {
      const latestRun = test.runs[0] || null;
      return {
        id: test.id,
        title: test.title,
        status: test.status,
        objective: test.objective,
        latestVersion: test.latestVersion,
        latestRunStatus: latestRun?.status || "not_run",
        latestVideoPath: latestRun?.videoPath || "",
        updatedAt: test.updatedAt,
        createdAt: test.createdAt
      };
    });
  }

  getTest(testId) {
    this.ensureLoaded();
    return this.state.tests.find((test) => test.id === testId) || null;
  }

  updateTest(payload) {
    this.ensureLoaded();
    const test = this.state.tests.find((item) => item.id === payload.testId);
    if (!test) {
      throw new Error(`Test not found: ${payload.testId}`);
    }

    const previous = test.versions[test.versions.length - 1];
    const nextVersion = test.latestVersion + 1;
    const updatedAt = nowIso();
    const objective = (payload.objective || previous.objective || "").trim();
    const notes = (payload.notes || "").trim();
    const status = payload.status || "pending_approval";
    const title = asTitle(payload.title || objective || test.title);

    test.latestVersion = nextVersion;
    test.title = title;
    test.objective = objective;
    test.status = status;
    test.updatedAt = updatedAt;
    test.versions.push({
      id: `${test.id}_v${nextVersion}`,
      number: nextVersion,
      objective,
      notes,
      status,
      sourceType: "user_edit",
      plan: previous?.plan || {},
      createdAt: updatedAt
    });

    this.state.tests = sortByNewest(this.state.tests, "updatedAt");
    this.persist();
    return this.getTest(test.id);
  }

  regenerateTest(payload) {
    this.ensureLoaded();
    const test = this.state.tests.find((item) => item.id === payload.testId);
    if (!test) {
      throw new Error(`Test not found: ${payload.testId}`);
    }

    const previous = test.versions[test.versions.length - 1];
    const nextVersion = test.latestVersion + 1;
    const updatedAt = nowIso();
    const instruction = (payload.instruction || "").trim();
    const objective = instruction
      ? `${previous.objective} Regenerated with instruction: ${instruction}`
      : `${previous.objective} Regenerated for another review cycle.`;

    test.latestVersion = nextVersion;
    test.objective = objective;
    test.status = "pending_approval";
    test.updatedAt = updatedAt;
    test.versions.push({
      id: `${test.id}_v${nextVersion}`,
      number: nextVersion,
      objective,
      notes: instruction || "Regenerated version requested from UI.",
      status: "pending_approval",
      sourceType: "regenerated",
      plan: previous?.plan || {},
      createdAt: updatedAt
    });

    this.state.tests = sortByNewest(this.state.tests, "updatedAt");
    this.persist();
    return this.getTest(test.id);
  }
}

module.exports = {
  CatalogService
};

