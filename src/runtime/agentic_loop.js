const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function parseDotEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const out = {};
  if (!fs.existsSync(envPath)) {
    return out;
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx < 0) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, "");
  }
  return out;
}

class AgenticStore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dbDir = path.join(projectRoot, "db");
    this.dbPath = path.join(this.dbDir, "agentic.json");
    ensureDir(this.dbDir);
    ensureDir(path.join(this.dbDir, "agentic_artifacts"));

    if (!fs.existsSync(this.dbPath)) {
      this.write({ schemaVersion: "0.1.0", forests: [], runs: [] });
    }
  }

  read() {
    return JSON.parse(fs.readFileSync(this.dbPath, "utf8"));
  }

  write(db) {
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }

  listForests() {
    return this.read().forests;
  }

  getForest(forestId) {
    return this.read().forests.find((f) => f.forestId === forestId) || null;
  }

  createForest(input) {
    const db = this.read();
    const forest = {
      forestId: `forest_${Date.now()}`,
      projectName: input.projectName || "Jungle Project",
      url: input.url,
      objective: input.objective || "Generate and execute generalized Playwright tests",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      trees: []
    };
    db.forests.unshift(forest);
    this.write(db);
    return forest;
  }

  addTree(forestId, treeInput) {
    const db = this.read();
    const forest = db.forests.find((f) => f.forestId === forestId);
    if (!forest) throw new Error("Forest not found");

    const version = (forest.trees[0]?.version || 0) + 1;
    const tree = {
      treeId: `tree_${Date.now()}`,
      version,
      status: "draft",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      procedure: treeInput.procedure,
      requestParser: treeInput.requestParser,
      executionProfile: treeInput.executionProfile || { recordVideo: true },
      lastRunId: null
    };

    forest.trees.unshift(tree);
    forest.updatedAt = nowIso();
    this.write(db);
    return { forest, tree };
  }

  listTrees(forestId) {
    const forest = this.getForest(forestId);
    return forest ? forest.trees : [];
  }

  updateTree(forestId, treeId, updater) {
    const db = this.read();
    const forest = db.forests.find((f) => f.forestId === forestId);
    if (!forest) throw new Error("Forest not found");
    const idx = forest.trees.findIndex((t) => t.treeId === treeId);
    if (idx < 0) throw new Error("Tree not found");
    const next = updater({ ...forest.trees[idx] });
    next.updatedAt = nowIso();
    forest.trees[idx] = next;
    forest.updatedAt = nowIso();
    this.write(db);
    return next;
  }

  addRun(forestId, treeId, runInput) {
    const db = this.read();
    const run = {
      runId: `agentic_run_${Date.now()}`,
      forestId,
      treeId,
      createdAt: nowIso(),
      status: runInput.status,
      steps: runInput.steps,
      artifacts: runInput.artifacts,
      summary: runInput.summary,
      videoPath: runInput.videoPath || null
    };
    db.runs.unshift(run);

    const forest = db.forests.find((f) => f.forestId === forestId);
    const tree = forest?.trees.find((t) => t.treeId === treeId);
    if (tree) {
      tree.lastRunId = run.runId;
      tree.status = run.status === "pass" ? "validated" : "failed";
      tree.updatedAt = nowIso();
    }
    if (forest) forest.updatedAt = nowIso();

    this.write(db);
    return run;
  }

  listRuns(forestId) {
    const runs = this.read().runs;
    return forestId ? runs.filter((r) => r.forestId === forestId) : runs;
  }
}

async function inspectWebsite(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const context = await page.evaluate(() => {
      const takeTexts = (selector, limit = 8) =>
        Array.from(document.querySelectorAll(selector))
          .map((el) => (el.innerText || el.textContent || "").trim())
          .filter(Boolean)
          .slice(0, limit);

      return {
        title: document.title,
        url: location.href,
        headings: takeTexts("h1, h2, h3", 12),
        buttons: takeTexts("button, [role='button']", 12),
        links: takeTexts("a", 12),
        hasForms: !!document.querySelector("form"),
        inputs: Array.from(document.querySelectorAll("input, textarea, select"))
          .map((el) => el.getAttribute("name") || el.id || el.getAttribute("placeholder") || el.tagName)
          .slice(0, 10)
      };
    });

    return context;
  } finally {
    await browser.close();
  }
}

function fallbackProcedure(inspection, objective, notes) {
  const firstHeading = inspection.headings?.[0] || inspection.title || "main page";
  const firstButton = inspection.buttons?.[0] || "primary button";
  return {
    summary: `Validate ${firstHeading} flow and core interactions for objective: ${objective}`,
    confirmMessage:
      "Confirm this testing procedure. You can add extra checks before execution (auth, edge cases, copy assertions).",
    steps: [
      { action: "goto", target: inspection.url || "/", assert: `Page title contains ${inspection.title || "expected title"}` },
      { action: "assertVisible", target: `text=${firstHeading}` },
      { action: "click", target: `text=${firstButton}` },
      { action: "assertText", target: "body", value: "pass" },
      { action: "screenshot", target: "fullPage" }
    ],
    notes: notes || ""
  };
}

async function generateProcedureWithGemini(apiKey, inspection, objective, notes) {
  if (!apiKey) {
    return fallbackProcedure(inspection, objective, notes);
  }

  const prompt = `Generate a generalized Playwright testing procedure as strict JSON with keys: summary, confirmMessage, steps(array), notes.
Each step must include: action and target; optional value/assert.
Use robust selectors (role/text/ids when present) and avoid hardcoded business values.
Website inspection context:\n${JSON.stringify(inspection, null, 2)}
Objective: ${objective}
Additional notes: ${notes || "none"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    }
  );

  if (!response.ok) {
    return fallbackProcedure(inspection, objective, notes);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try {
    const body = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text;
    const parsed = JSON.parse(body.trim());
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return fallbackProcedure(inspection, objective, notes);
    }
    return parsed;
  } catch (_) {
    return fallbackProcedure(inspection, objective, notes);
  }
}

async function runCodexMcpStep({ objective, url, inspection, timeoutMs = 120000, cwd }) {
  return new Promise((resolve) => {
    const prompt = [
      "Initiate MCP testing procedure for this project.",
      `Target URL: ${url}`,
      `Objective: ${objective}`,
      "Return strict JSON with keys: parser_plan, selector_strategy, risk_checks, suggested_steps.",
      "Website context:",
      JSON.stringify(inspection)
    ].join("\n");

    const child = spawn("codex", ["exec", prompt], {
      shell: true,
      cwd: cwd || process.cwd(),
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        // ignore
      }
      finish({
        status: "timeout",
        pass: false,
        reason: `codex exec timed out after ${timeoutMs}ms`,
        stdout,
        stderr
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        status: "error",
        pass: false,
        reason: error.message,
        stdout,
        stderr
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        status: code === 0 ? "ok" : "error",
        pass: code === 0,
        reason: code === 0 ? "Codex MCP planning completed" : `codex exited with code ${code}`,
        stdout,
        stderr
      });
    });
  });
}

function buildRequestParser(procedure) {
  return {
    parserVersion: "0.1.0",
    normalizedSteps: (procedure.steps || []).map((s, i) => ({
      index: i,
      action: s.action,
      target: s.target,
      value: s.value || null,
      assert: s.assert || null
    }))
  };
}

function stepToCode(step) {
  const target = JSON.stringify(step.target || "body");
  const value = JSON.stringify(step.value || "");

  switch (step.action) {
    case "goto":
      return `await page.goto(${target}, { waitUntil: 'domcontentloaded' });`;
    case "click":
      return `await page.locator(${target}).first().click();`;
    case "fill":
      return `await page.locator(${target}).first().fill(${value});`;
    case "assertVisible":
      return `await expect(page.locator(${target}).first()).toBeVisible();`;
    case "assertText":
      return `await expect(page.locator(${target}).first()).toContainText(${value});`;
    case "screenshot":
      return `await page.screenshot({ path: path.join(artifactsDir, 'step_${Date.now()}.png'), fullPage: true });`;
    default:
      return `// TODO unsupported action: ${step.action}`;
  }
}

function generatePlaywrightProgram(parser) {
  const lines = parser.normalizedSteps.map((s) => stepToCode(s)).join("\n  ");
  return `const path = require('node:path');\nconst fs = require('node:fs');\nconst { chromium, expect } = require('playwright');\n\nasync function run({ baseUrl, artifactsDir }) {\n  const browser = await chromium.launch({ headless: true });\n  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });\n  const page = await context.newPage();\n  try {\n  ${lines}\n  } finally {\n    await context.close();\n    await browser.close();\n  }\n}\n\nmodule.exports = { run };\n`;
}

async function executeProcedure(url, parser, artifactsDir) {
  ensureDir(artifactsDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();

  const stepResults = [];
  let status = "pass";
  let summary = "Procedure executed successfully.";

  try {
    for (const step of parser.normalizedSteps) {
      const s = { index: step.index, action: step.action, target: step.target, status: "pass", note: "ok" };
      try {
        if (step.action === "goto") {
          const dest = step.target?.startsWith("http") ? step.target : new URL(step.target || "/", url).toString();
          await page.goto(dest, { waitUntil: "domcontentloaded", timeout: 30000 });
        } else if (step.action === "click") {
          await page.locator(step.target).first().click({ timeout: 10000 });
        } else if (step.action === "fill") {
          await page.locator(step.target).first().fill(step.value || "", { timeout: 10000 });
        } else if (step.action === "assertVisible") {
          await page.locator(step.target).first().waitFor({ state: "visible", timeout: 10000 });
        } else if (step.action === "assertText") {
          const txt = await page.locator(step.target).first().innerText({ timeout: 10000 });
          if (!txt.includes(step.value || "")) {
            throw new Error(`Text assertion failed: expected includes '${step.value}' got '${txt}'`);
          }
        } else if (step.action === "screenshot") {
          await page.screenshot({ path: path.join(artifactsDir, `step_${Date.now()}.png`), fullPage: true });
        }
      } catch (error) {
        s.status = "fail";
        s.note = error.message;
        status = "fail";
        summary = `Failed at step ${step.index + 1}: ${error.message}`;
      }

      stepResults.push(s);
      if (status === "fail") break;
    }

    await page.screenshot({ path: path.join(artifactsDir, `final_${Date.now()}.png`), fullPage: true });
  } finally {
    await context.close();
    await browser.close();
  }

  const videos = fs
    .readdirSync(artifactsDir)
    .filter((n) => n.endsWith(".webm"))
    .map((n) => path.join(artifactsDir, n));

  return {
    status,
    summary,
    steps: stepResults,
    videoPath: videos[0] || null,
    artifacts: fs.readdirSync(artifactsDir).map((n) => path.join(artifactsDir, n))
  };
}

class AgenticLoopManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.store = new AgenticStore(projectRoot);
  }

  listForests() {
    return this.store.listForests();
  }

  listTrees(forestId) {
    return this.store.listTrees(forestId);
  }

  listRuns(forestId) {
    return this.store.listRuns(forestId);
  }

  async createDraft(input) {
    const env = { ...parseDotEnv(this.projectRoot), ...process.env };
    const inspection = await inspectWebsite(input.url);
    const procedure = await generateProcedureWithGemini(
      env.GEMINI_API_KEY,
      inspection,
      input.objective || "Validate critical user flow",
      input.notes || ""
    );

    const parser = buildRequestParser(procedure);
    const forest = input.forestId ? this.store.getForest(input.forestId) : this.store.createForest(input);
    const { tree } = this.store.addTree(forest.forestId, {
      procedure,
      requestParser: parser,
      executionProfile: { recordVideo: true, mode: "playwright" }
    });

    return { forestId: forest.forestId, tree };
  }

  async confirmAndRun(input, emitEvent) {
    const trees = this.store.listTrees(input.forestId);
    const tree = trees.find((t) => t.treeId === input.treeId);
    if (!tree) throw new Error("Tree not found for confirmation");

    const finalProcedure = {
      ...tree.procedure,
      notes: [tree.procedure.notes || "", input.additions || ""].filter(Boolean).join("\n")
    };

    const parser = buildRequestParser(finalProcedure);
    const artifactsDir = path.join(
      this.projectRoot,
      "db",
      "agentic_artifacts",
      `${input.forestId}_${input.treeId}_${Date.now()}`
    );
    ensureDir(artifactsDir);

    const playwrightProgram = generatePlaywrightProgram(parser);
    const parserPath = path.join(artifactsDir, "request_parser.json");
    const programPath = path.join(artifactsDir, "playwright_executor.generated.js");
    fs.writeFileSync(parserPath, JSON.stringify(parser, null, 2), "utf8");
    fs.writeFileSync(programPath, playwrightProgram, "utf8");

    emitEvent?.({ type: "agentic_status", value: "WELCOME TO THE JUNGLE" });
    emitEvent?.({ type: "agentic_status", value: "Codex terminal calls MCP to initiate testing procedure..." });

    const inspection = await inspectWebsite(input.url);
    const codexMcpResult = await runCodexMcpStep({
      objective: finalProcedure.summary,
      url: input.url,
      inspection,
      timeoutMs: input.codexTimeoutMs || 120000,
      cwd: this.projectRoot
    });

    const codexTranscriptPath = path.join(artifactsDir, "codex_mcp_transcript.txt");
    fs.writeFileSync(
      codexTranscriptPath,
      [`status=${codexMcpResult.status}`, `reason=${codexMcpResult.reason}`, "", codexMcpResult.stdout, "", codexMcpResult.stderr].join("\n"),
      "utf8"
    );

    emitEvent?.({
      type: "agentic_status",
      value: codexMcpResult.pass
        ? "Codex MCP planning complete. Converting into Request Parser and Playwright Executor..."
        : `Codex MCP unavailable (${codexMcpResult.reason}). Continuing with local planner.`
    });

    const result = await executeProcedure(input.url, parser, artifactsDir);
    const run = this.store.addRun(input.forestId, input.treeId, {
      status: result.status,
      steps: result.steps,
      artifacts: [
        { type: "codex_mcp", path: codexTranscriptPath },
        { type: "parser", path: parserPath },
        { type: "executor", path: programPath }
      ].concat(result.artifacts.map((p) => ({ type: p.endsWith(".webm") ? "video" : "artifact", path: p }))),
      videoPath: result.videoPath,
      summary: result.summary
    });

    this.store.updateTree(input.forestId, input.treeId, (draft) => ({
      ...draft,
      status: run.status === "pass" ? "validated" : "failed",
      requestParser: parser,
      confirmedAt: nowIso(),
      procedure: finalProcedure
    }));

    return { run, treeId: input.treeId, forestId: input.forestId };
  }

  async redoRun(input, emitEvent) {
    return this.confirmAndRun(input, emitEvent);
  }

  async forkTree(input) {
    const trees = this.store.listTrees(input.forestId);
    const source = trees.find((t) => t.treeId === input.fromTreeId);
    if (!source) throw new Error("Source tree not found");

    const tweaked = {
      ...source.procedure,
      summary: `${source.procedure.summary} (forked variant)`,
      notes: [source.procedure.notes || "", input.notes || ""].filter(Boolean).join("\n")
    };

    const { tree } = this.store.addTree(input.forestId, {
      procedure: tweaked,
      requestParser: buildRequestParser(tweaked),
      executionProfile: source.executionProfile
    });

    return tree;
  }
}

module.exports = {
  AgenticLoopManager
};
