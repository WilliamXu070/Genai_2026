const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { CatalogService } = require("../catalog/service");
const { AgenticMySqlPersistenceService, ensureSummaryArray } = require("./agentic_mysql_persistence");

const SUPPORTED_TARGET_TYPES = new Set(["web_frontend", "electron_app"]);
const SUPPORTED_SEED_MODES = new Set(["none", "script", "jungle_shared_or_sample"]);

function readPackageJson(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function getProjectSignals(projectRoot) {
  const packageJson = readPackageJson(projectRoot);
  const scripts = packageJson?.scripts || {};
  const dependencies = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };
  const mainEntry = packageJson?.main ? path.resolve(projectRoot, packageJson.main) : null;

  return {
    dependencies: Object.keys(dependencies),
    hasElectronDependency: Object.prototype.hasOwnProperty.call(dependencies, "electron"),
    hasMainEntry: Boolean(mainEntry && fs.existsSync(mainEntry)),
    mainEntry,
    projectName: packageJson?.name || path.basename(projectRoot),
    scripts
  };
}

function chooseWebStartupCommand(signals) {
  if (signals.scripts.dev) {
    return "npm run dev";
  }
  if (signals.scripts.start) {
    return "npm start";
  }
  return null;
}

function chooseElectronStartupCommand(signals) {
  if (signals.scripts.start) {
    return "npm start";
  }
  if (signals.scripts.dev) {
    return "npm run dev";
  }
  return null;
}

function chooseSeedCommand(signals) {
  const candidateScripts = ["seed", "db:seed", "seed:sample", "db:mysql:seed:build"];
  const scriptName = candidateScripts.find((name) => signals.scripts[name]);
  return scriptName ? `npm run ${scriptName}` : null;
}

function looksLikeJungleProject(projectRoot, signals) {
  return Boolean(
    fs.existsSync(path.join(projectRoot, "src", "runtime", "agentic_loop.js")) &&
    fs.existsSync(path.join(projectRoot, "src", "main.js")) &&
    (signals.projectName === "jungle" || signals.hasElectronDependency)
  );
}

function resolveLaunchEnv(projectRoot, targetType) {
  const launchEnv = {};
  const storageRoot = process.env.JUNGLE_STORAGE_ROOT || "";
  if (storageRoot) {
    launchEnv.JUNGLE_STORAGE_ROOT = storageRoot;
  }
  if (targetType === "electron_app") {
    launchEnv.JUNGLE_PROJECT_ROOT = projectRoot;
  }
  return launchEnv;
}

function deterministicSeedingPlan({ projectRoot, signals, targetType }) {
  if (targetType !== "electron_app") {
    return {
      mode: "none",
      command: null,
      reasoning: "No runtime seeding required for browser-served target."
    };
  }

  const seedCommand = chooseSeedCommand(signals);
  if (seedCommand) {
    return {
      mode: "script",
      command: seedCommand,
      reasoning: `Using package script seeding path via ${seedCommand}.`
    };
  }

  if (looksLikeJungleProject(projectRoot, signals)) {
    return {
      mode: "jungle_shared_or_sample",
      command: null,
      reasoning: "Detected Jungle Electron runtime; reuse shared storage and seed deterministic sample data when persistence is empty."
    };
  }

  return {
    mode: "none",
    command: null,
    reasoning: "No deterministic seeding strategy detected."
  };
}

async function probeUrl(url, timeoutMs = 1500, fetchImpl = fetch) {
  if (!url) {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTargetType(inputTargetType, signals, input) {
  if (SUPPORTED_TARGET_TYPES.has(inputTargetType)) {
    return inputTargetType;
  }
  if (signals.hasElectronDependency && signals.hasMainEntry && !input?.url) {
    return "electron_app";
  }
  return "web_frontend";
}

function buildEnvironmentPlanningPrompt({ projectRoot, input, signals, targetType }) {
  return [
    "You are planning how to make a local application testable before Playwright code generation.",
    "Return strict JSON only with keys:",
    "targetType, playwrightMode, startupRequired, startupCommand, startupCwd, readiness, launchTarget, launchEnv, seeding, reasoning.",
    "Allowed targetType values: web_frontend, electron_app.",
    "Allowed playwrightMode values: web, electron.",
    "Allowed seeding.mode values: none, script, jungle_shared_or_sample.",
    "Rules:",
    "- Choose only one of the allowed target types.",
    "- If targetType is electron_app, launchTarget.kind must be electron_app.",
    "- If targetType is web_frontend, launchTarget.kind must be url.",
    "- startupCommand must be a concrete local command or null.",
    "- readiness.kind must be url for web_frontend and electron_window for electron_app.",
    "- launchEnv must be an object of string environment variables if runtime state must be shared.",
    "- seeding must describe whether the environment should be seeded with real/shared data or deterministic sample data before launch.",
    "- reasoning must mention the concrete project signals used.",
    "",
    `Project root: ${projectRoot}`,
    `Requested task: ${input?.objective || input?.task || "Validate critical user flow"}`,
    `Requested target type: ${input?.targetType || "not provided"}`,
    `Requested URL: ${input?.url || "not provided"}`,
    `Package scripts: ${JSON.stringify(signals.scripts)}`,
    `Main entry: ${signals.mainEntry || "none"}`,
    `Dependencies: ${JSON.stringify(signals.dependencies.slice(0, 40))}`,
    `Deterministic target guess: ${targetType}`
  ].join("\n");
}

function deterministicEnvironmentPlan({ projectRoot, input, signals }) {
  const targetType = normalizeTargetType(input?.targetType, signals, input);
  const launchEnv = resolveLaunchEnv(projectRoot, targetType);
  const seeding = deterministicSeedingPlan({ projectRoot, signals, targetType });
  if (targetType === "electron_app") {
    return {
      targetType,
      playwrightMode: "electron",
      startupRequired: false,
      startupCommand: chooseElectronStartupCommand(signals),
      startupCwd: projectRoot,
      readiness: {
        kind: "electron_window",
        target: signals.mainEntry || projectRoot
      },
      launchTarget: {
        kind: "electron_app",
        value: projectRoot
      },
      launchEnv,
      seeding,
      reasoning: `Detected Electron project via dependency=${signals.hasElectronDependency} mainEntry=${signals.mainEntry || "missing"}. ${seeding.reasoning}`
    };
  }

  return {
    targetType,
    playwrightMode: "web",
    startupRequired: true,
    startupCommand: chooseWebStartupCommand(signals),
    startupCwd: projectRoot,
    readiness: {
      kind: "url",
      target: input?.url || "http://127.0.0.1:3000"
    },
    launchTarget: {
      kind: "url",
      value: input?.url || "http://127.0.0.1:3000"
    },
    launchEnv,
    seeding,
    reasoning: `Detected browser-served frontend via requested URL ${input?.url || "default http://127.0.0.1:3000"} and available scripts.`
  };
}

function sanitizeLaunchEnv(candidateLaunchEnv, fallbackLaunchEnv) {
  const merged = { ...(fallbackLaunchEnv || {}) };
  if (!candidateLaunchEnv || typeof candidateLaunchEnv !== "object") {
    return merged;
  }
  Object.entries(candidateLaunchEnv).forEach(([key, value]) => {
    if (!key || typeof value !== "string" || !value.trim()) {
      return;
    }
    merged[key] = value.trim();
  });
  return merged;
}

function sanitizeSeeding(candidateSeeding, fallbackSeeding) {
  const mode = SUPPORTED_SEED_MODES.has(candidateSeeding?.mode) ? candidateSeeding.mode : fallbackSeeding.mode;
  return {
    mode,
    command:
      mode === "script" && typeof candidateSeeding?.command === "string" && candidateSeeding.command.trim()
        ? candidateSeeding.command.trim()
        : mode === "script"
          ? fallbackSeeding.command
          : null,
    reasoning: String(candidateSeeding?.reasoning || fallbackSeeding.reasoning || "")
  };
}

function sanitizePlannedObject(candidate, fallbackPlan, projectRoot) {
  const targetType = SUPPORTED_TARGET_TYPES.has(candidate?.targetType) ? candidate.targetType : fallbackPlan.targetType;
  const playwrightMode =
    targetType === "electron_app"
      ? "electron"
      : candidate?.playwrightMode === "web"
        ? "web"
        : fallbackPlan.playwrightMode;

  return {
    targetType,
    playwrightMode,
    startupRequired:
      typeof candidate?.startupRequired === "boolean" ? candidate.startupRequired : fallbackPlan.startupRequired,
    startupCommand:
      typeof candidate?.startupCommand === "string" && candidate.startupCommand.trim()
        ? candidate.startupCommand.trim()
        : fallbackPlan.startupCommand,
    startupCwd:
      typeof candidate?.startupCwd === "string" && candidate.startupCwd.trim()
        ? path.resolve(projectRoot, candidate.startupCwd)
        : fallbackPlan.startupCwd,
    readiness:
      candidate?.readiness && typeof candidate.readiness === "object"
        ? {
            kind: candidate.readiness.kind || fallbackPlan.readiness.kind,
            target: candidate.readiness.target || fallbackPlan.readiness.target
          }
        : fallbackPlan.readiness,
    launchTarget:
      candidate?.launchTarget && typeof candidate.launchTarget === "object"
        ? {
            kind: candidate.launchTarget.kind || fallbackPlan.launchTarget.kind,
            value: candidate.launchTarget.value || fallbackPlan.launchTarget.value
          }
        : fallbackPlan.launchTarget,
    launchEnv: sanitizeLaunchEnv(candidate?.launchEnv, fallbackPlan.launchEnv),
    seeding: sanitizeSeeding(candidate?.seeding, fallbackPlan.seeding),
    reasoning: String(candidate?.reasoning || fallbackPlan.reasoning || "")
  };
}

async function tryOpenAiPlan({ prompt, apiKey, fetchImpl = fetch, fallbackPlan, projectRoot }) {
  if (!apiKey) {
    return fallbackPlan;
  }

  try {
    const model = process.env.OPENAI_ENV_PLANNER_MODEL || "gpt-5";
    const requestBody = {
      model,
      input: prompt
    };
    if (/^gpt-5/i.test(model)) {
      requestBody.reasoning = {
        effort: process.env.OPENAI_ENV_PLANNER_REASONING_EFFORT || "medium"
      };
    }

    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return fallbackPlan;
    }

    const data = await response.json();
    const text = String(data?.output_text || "");
    const jsonBlock = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text;
    const parsed = JSON.parse(jsonBlock.trim());
    return sanitizePlannedObject(parsed, fallbackPlan, projectRoot);
  } catch (_) {
    return fallbackPlan;
  }
}

async function planExecutionEnvironment({ projectRoot, input = {}, openAiApiKey, fetchImpl = fetch }) {
  const signals = getProjectSignals(projectRoot);
  const fallbackPlan = deterministicEnvironmentPlan({ projectRoot, input, signals });
  const prompt = buildEnvironmentPlanningPrompt({
    projectRoot,
    input,
    signals,
    targetType: fallbackPlan.targetType
  });

  const plan = await tryOpenAiPlan({
    prompt,
    apiKey: openAiApiKey,
    fetchImpl,
    fallbackPlan,
    projectRoot
  });

  return {
    ...plan,
    prompt,
    projectSignals: signals
  };
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function terminateChildProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore"
    });
    return;
  }

  child.kill("SIGTERM");
}

async function runShellCommand(command, cwd, env) {
  if (!command) {
    return { status: "skipped" };
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env,
      stdio: "ignore"
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({ status: "ok" });
        return;
      }
      reject(new Error(`Seed command failed with exit code ${code}: ${command}`));
    });
  });
}

async function ensureJungleSharedOrSampleSeed(plan, env) {
  const projectRoot = plan?.launchTarget?.value || plan?.startupCwd || process.cwd();
  const storageRoot = env.JUNGLE_STORAGE_ROOT || process.env.JUNGLE_STORAGE_ROOT || "";

  if (storageRoot) {
    const catalog = new CatalogService({ workspaceRoot: projectRoot, storageRoot });
    catalog.listTests();
  }

  const persistence = new AgenticMySqlPersistenceService();
  if (!persistence.isEnabled()) {
    return { mode: "catalog_only", seeded: Boolean(storageRoot) };
  }

  const existingProjects = await persistence.listProjects();
  if (existingProjects.length > 0) {
    return { mode: "shared_runtime", seeded: false };
  }

  const project = await persistence.getOrCreateProjectByName("Jungle Sample Project");
  const approvalInstructions = [
    "Objective: Review the approval-gated Jungle desktop flow",
    "Target Type: electron_app",
    "Target: Electron app at Jungle",
    "Notes: This sample data was seeded so the Electron orchestrator has stable state to inspect.",
    "Planned Steps:",
    "1. assertVisible text=Jungle Approval Queue",
    "2. assertVisible text=To Be Approved",
    "3. assertVisible text=Currently In Progress"
  ].join("\n\n");
  const pendingRun = await persistence.createDraftingRun({
    projectId: project.id,
    testingInstructions: approvalInstructions,
    threePointSummary: ensureSummaryArray([
      "Seeded sample approval run.",
      "Use this to validate the desktop approval queue renders persisted state.",
      "Approve or inspect this run from the UI."
    ]),
    draftPayload: {
      objective: "Review the approval-gated Jungle desktop flow",
      projectName: "Jungle",
      targetType: "electron_app"
    }
  });
  await persistence.markRunAwaitingApproval({
    testRunId: pendingRun.id,
    testingInstructions: approvalInstructions,
    threePointSummary: ensureSummaryArray([
      "Seeded sample approval run.",
      "Queued for review in the desktop UI.",
      "Execution is intentionally paused."
    ]),
    draftPayload: {
      objective: "Review the approval-gated Jungle desktop flow",
      projectName: "Jungle",
      targetType: "electron_app"
    }
  });

  const completedInstructions = [
    "Objective: Review a completed Jungle desktop run",
    "Target Type: electron_app",
    "Target: Electron app at Jungle",
    "Notes: Historical sample run for timeline/history rendering."
  ].join("\n\n");
  const completeRun = await persistence.createDraftingRun({
    projectId: project.id,
    testingInstructions: completedInstructions,
    threePointSummary: ensureSummaryArray([
      "Seeded completed run.",
      "Provides non-empty history state.",
      "Used when no real project history exists yet."
    ]),
    draftPayload: {
      objective: "Review a completed Jungle desktop run",
      projectName: "Jungle",
      targetType: "electron_app"
    }
  });
  await persistence.markRunAwaitingApproval({
    testRunId: completeRun.id,
    testingInstructions: completedInstructions,
    threePointSummary: ensureSummaryArray([
      "Seeded completed run.",
      "Advancing directly to passed state for history coverage.",
      "No live execution attached."
    ]),
    draftPayload: {
      objective: "Review a completed Jungle desktop run",
      projectName: "Jungle",
      targetType: "electron_app"
    }
  });
  await persistence.approveRun({
    runId: completeRun.id,
    approvedBy: "system_seed"
  });
  await persistence.claimApprovedRunForExecution(completeRun.id);
  await persistence.finalizeRun({
    testRunId: completeRun.id,
    executionTimeMs: 1200,
    loopCount: 1,
    status: "passed",
    testingInstructions: completedInstructions,
    videoReference: null,
    threePointSummary: ensureSummaryArray([
      "Seeded completed run.",
      "Provides stable desktop history state.",
      "Replace with real runs once orchestration starts."
    ]),
    lastErrorText: null
  });

  return { mode: "sample", seeded: true };
}

async function ensureEnvironmentDataSeeded(plan, options = {}) {
  const seeding = plan?.seeding || { mode: "none", command: null };
  const env = {
    ...process.env,
    ...(plan?.launchEnv || {}),
    ...(options.env || {})
  };
  const previousProjectRoot = process.env.JUNGLE_PROJECT_ROOT;
  const previousStorageRoot = process.env.JUNGLE_STORAGE_ROOT;
  if (env.JUNGLE_PROJECT_ROOT) {
    process.env.JUNGLE_PROJECT_ROOT = env.JUNGLE_PROJECT_ROOT;
  }
  if (env.JUNGLE_STORAGE_ROOT) {
    process.env.JUNGLE_STORAGE_ROOT = env.JUNGLE_STORAGE_ROOT;
  }

  try {
    if (seeding.mode === "script" && seeding.command) {
      await runShellCommand(seeding.command, plan.startupCwd || process.cwd(), env);
      return { mode: "script", seeded: true };
    }

    if (seeding.mode === "jungle_shared_or_sample") {
      return ensureJungleSharedOrSampleSeed(plan, env);
    }

    return { mode: "none", seeded: false };
  } finally {
    if (previousProjectRoot === undefined) {
      delete process.env.JUNGLE_PROJECT_ROOT;
    } else {
      process.env.JUNGLE_PROJECT_ROOT = previousProjectRoot;
    }
    if (previousStorageRoot === undefined) {
      delete process.env.JUNGLE_STORAGE_ROOT;
    } else {
      process.env.JUNGLE_STORAGE_ROOT = previousStorageRoot;
    }
  }
}

async function ensureExecutionEnvironment(plan, options = {}) {
  await ensureEnvironmentDataSeeded(plan, options);

  if (plan.playwrightMode === "electron") {
    return {
      plan,
      started: false,
      child: null,
      cleanup: async () => {}
    };
  }

  const probe = options.probeUrlImpl || probeUrl;
  const spawnImpl = options.spawnImpl || spawn;
  const readinessUrl = plan?.readiness?.target || plan?.launchTarget?.value;
  const alreadyRunning = await probe(readinessUrl, options.initialProbeTimeoutMs || 1200, options.fetchImpl || fetch);
  if (alreadyRunning) {
    return {
      plan,
      started: false,
      child: null,
      cleanup: async () => {}
    };
  }

  if (!plan.startupCommand) {
    throw new Error(`No startup command available for ${plan.targetType}`);
  }

  const child = spawnImpl(plan.startupCommand, {
    shell: true,
    cwd: plan.startupCwd,
    env: {
      ...process.env,
      ...(plan.launchEnv || {}),
      ...(options.env || {})
    },
    stdio: "ignore"
  });

  const startedAt = Date.now();
  const timeoutMs = options.readinessTimeoutMs || 20000;
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await probe(readinessUrl, options.pollProbeTimeoutMs || 1200, options.fetchImpl || fetch);
    if (ready) {
      return {
        plan,
        started: true,
        child,
        cleanup: async () => {
          if (child.exitCode === null && !child.killed) {
            terminateChildProcessTree(child);
            await waitForExit(child);
          }
        }
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  if (child.exitCode === null && !child.killed) {
    terminateChildProcessTree(child);
    await waitForExit(child);
  }
  throw new Error(`Timed out waiting for environment readiness at ${readinessUrl}`);
}

module.exports = {
  SUPPORTED_TARGET_TYPES,
  buildEnvironmentPlanningPrompt,
  deterministicEnvironmentPlan,
  ensureEnvironmentDataSeeded,
  ensureExecutionEnvironment,
  getProjectSignals,
  planExecutionEnvironment,
  probeUrl
};
