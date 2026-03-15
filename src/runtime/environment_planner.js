const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const SUPPORTED_TARGET_TYPES = new Set(["web_frontend", "electron_app"]);

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
    "targetType, playwrightMode, startupRequired, startupCommand, startupCwd, readiness, launchTarget, reasoning.",
    "Allowed targetType values: web_frontend, electron_app.",
    "Allowed playwrightMode values: web, electron.",
    "Rules:",
    "- Choose only one of the allowed target types.",
    "- If targetType is electron_app, launchTarget.kind must be electron_app.",
    "- If targetType is web_frontend, launchTarget.kind must be url.",
    "- startupCommand must be a concrete local command or null.",
    "- readiness.kind must be url for web_frontend and electron_window for electron_app.",
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
      reasoning: `Detected Electron project via dependency=${signals.hasElectronDependency} mainEntry=${signals.mainEntry || "missing"}.`
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
    reasoning: `Detected browser-served frontend via requested URL ${input?.url || "default http://127.0.0.1:3000"} and available scripts.`
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
    reasoning: String(candidate?.reasoning || fallbackPlan.reasoning || "")
  };
}

async function tryOpenAiPlan({ prompt, apiKey, fetchImpl = fetch, fallbackPlan, projectRoot }) {
  if (!apiKey) {
    return fallbackPlan;
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ENV_PLANNER_MODEL || "gpt-4.1-mini",
        input: prompt
      })
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

async function ensureExecutionEnvironment(plan, options = {}) {
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
  ensureExecutionEnvironment,
  getProjectSignals,
  planExecutionEnvironment,
  probeUrl
};
