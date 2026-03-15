const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AgenticLoopManager } = require("../src/runtime/agentic_loop");
const { closePool } = require("../src/db/mysql_agentic_client");
const JUNGLE_REPO_ROOT = path.resolve(__dirname, "..");

function parseEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) {
    return out;
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    out[key] = value;
  }
  return out;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseArgs(argv) {
  const args = [...argv];
  let inputJson = "";
  let inputFile = "";
  let inputStdin = false;
  let requestId = "";
  let projectRoot = "";
  let projectName = "";
  let task = "";
  let url = "";
  let notes = "";
  let additions = "";
  let targetType = "";
  let maxAttempts = "";
  let codexTimeoutMs = "";
  let actionDelayMs = "";
  let skipCodex = false;
  let storageRoot = "";
  let waitForFinal = false;
  let waitTimeoutMs = "";
  let waitPollMs = "";

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--input-json") {
      inputJson = args.shift() || "";
      continue;
    }
    if (token === "--input-file") {
      inputFile = args.shift() || "";
      continue;
    }
    if (token === "--input-stdin") {
      inputStdin = true;
      continue;
    }
    if (token === "--request-id") {
      requestId = args.shift() || "";
      continue;
    }
    if (token === "--project-root") {
      projectRoot = args.shift() || "";
      continue;
    }
    if (token === "--project-name") {
      projectName = args.shift() || "";
      continue;
    }
    if (token === "--task" || token === "--objective") {
      task = args.shift() || "";
      continue;
    }
    if (token === "--url") {
      url = args.shift() || "";
      continue;
    }
    if (token === "--notes") {
      notes = args.shift() || "";
      continue;
    }
    if (token === "--additions") {
      additions = args.shift() || "";
      continue;
    }
    if (token === "--target-type") {
      targetType = args.shift() || "";
      continue;
    }
    if (token === "--max-attempts") {
      maxAttempts = args.shift() || "";
      continue;
    }
    if (token === "--codex-timeout-ms") {
      codexTimeoutMs = args.shift() || "";
      continue;
    }
    if (token === "--action-delay-ms") {
      actionDelayMs = args.shift() || "";
      continue;
    }
    if (token === "--skip-codex") {
      skipCodex = true;
      continue;
    }
    if (token === "--storage-root") {
      storageRoot = args.shift() || "";
      continue;
    }
    if (token === "--wait-for-final") {
      waitForFinal = true;
      continue;
    }
    if (token === "--wait-timeout-ms") {
      waitTimeoutMs = args.shift() || "";
      continue;
    }
    if (token === "--wait-poll-ms") {
      waitPollMs = args.shift() || "";
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!inputJson && !inputFile && !inputStdin && !task) {
    throw new Error(
      "Provide --input-json, --input-file, --input-stdin, or shorthand flags like --task/--project-root/--url"
    );
  }

  let inlineRequest = null;
  if (task || projectRoot || projectName || url || notes || additions || targetType || maxAttempts || codexTimeoutMs || actionDelayMs || skipCodex) {
    inlineRequest = {
      requestId: requestId || `agentic_req_${Date.now()}`,
      type: "agentic:orchestrate-task",
      payload: {}
    };

    if (projectRoot) {
      inlineRequest.payload.projectRoot = projectRoot;
    }
    if (projectName) {
      inlineRequest.payload.projectName = projectName;
    }
    if (task) {
      inlineRequest.payload.task = task;
    }
    if (url) {
      inlineRequest.payload.url = url;
    }
    if (notes) {
      inlineRequest.payload.notes = notes;
    }
    if (additions) {
      inlineRequest.payload.additions = additions;
    }
    if (targetType) {
      inlineRequest.payload.targetType = targetType;
    }
    if (maxAttempts) {
      inlineRequest.payload.maxAttempts = Number(maxAttempts);
    }
    if (codexTimeoutMs) {
      inlineRequest.payload.codexTimeoutMs = Number(codexTimeoutMs);
    }
    if (actionDelayMs) {
      inlineRequest.payload.actionDelayMs = Number(actionDelayMs);
    }
    if (skipCodex) {
      inlineRequest.payload.skipCodex = true;
    }
  }

  return {
    inlineRequest,
    inputFile,
    inputJson,
    inputStdin,
    storageRoot,
    waitForFinal,
    waitTimeoutMs,
    waitPollMs
  };
}

function readInput({ inputFile, inputJson, inputStdin, inlineRequest }) {
  if (inlineRequest) {
    return inlineRequest;
  }
  if (inputFile) {
    return JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8"));
  }
  if (inputStdin) {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  }
  return JSON.parse(inputJson);
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveStorageRoot(explicitStorageRoot) {
  if (explicitStorageRoot) {
    return path.resolve(explicitStorageRoot);
  }
  if (process.env.JUNGLE_STORAGE_ROOT) {
    return path.resolve(process.env.JUNGLE_STORAGE_ROOT);
  }
  return path.join(os.homedir(), ".jungle", "runtime");
}

function normalizeRequest(request) {
  const type = request?.type || "agentic:orchestrate-task";
  if (type !== "agentic:orchestrate-task") {
    throw new Error(`Unsupported request type: ${type}`);
  }

  const payload = request?.payload || {};
  const cwdRoot = process.cwd();
  const resolvedProjectRoot = path.resolve(payload.projectRoot || cwdRoot);
  const resolvedProjectName = payload.projectName || path.basename(resolvedProjectRoot) || "Jungle";
  const task = (typeof payload.task === "string" && payload.task.trim()) ||
    (typeof payload.objective === "string" && payload.objective.trim());

  if (!task) {
    throw new Error("Request payload must include task or objective");
  }

  const requestedTargetType = typeof payload.targetType === "string" ? payload.targetType.trim() : "";
  if (requestedTargetType && !["web_frontend", "electron_app"].includes(requestedTargetType)) {
    throw new Error("Request payload targetType must be web_frontend or electron_app");
  }
  const effectiveTargetType = requestedTargetType || "web_frontend";

  const normalizedPayload = {
    additions: typeof payload.additions === "string" ? payload.additions : "",
    notes: typeof payload.notes === "string" ? payload.notes : "",
    projectName: resolvedProjectName,
    skipCodex: parseBoolean(payload.skipCodex),
    task,
    targetType: effectiveTargetType,
    url:
      typeof payload.url === "string" && payload.url.trim()
        ? payload.url.trim()
        : effectiveTargetType === "electron_app"
          ? ""
          : "http://127.0.0.1:3000"
  };

  const maxAttempts = toFiniteNumber(payload.maxAttempts);
  if (maxAttempts) {
    normalizedPayload.maxAttempts = maxAttempts;
  }
  const codexTimeoutMs = toFiniteNumber(payload.codexTimeoutMs);
  if (codexTimeoutMs) {
    normalizedPayload.codexTimeoutMs = codexTimeoutMs;
  }
  const actionDelayMs = toFiniteNumber(payload.actionDelayMs);
  if (actionDelayMs !== null) {
    normalizedPayload.actionDelayMs = actionDelayMs;
  }

  return {
    payload: normalizedPayload,
    projectRoot: resolvedProjectRoot,
    requestId: request?.requestId || `agentic_req_${Date.now()}`
  };
}

async function runAgenticRequest(request, options = {}) {
  const normalized = normalizeRequest(request);
  const storageRoot = resolveStorageRoot(options.storageRoot || "");
  const jungleEnv = parseEnvFile(path.join(JUNGLE_REPO_ROOT, ".env"));
  const storageEnv = parseEnvFile(path.join(storageRoot, ".env"));
  Object.entries(jungleEnv).forEach(([key, value]) => {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
  Object.entries(storageEnv).forEach(([key, value]) => {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
  process.env.JUNGLE_PROJECT_ROOT = normalized.projectRoot;
  process.env.JUNGLE_STORAGE_ROOT = storageRoot;
  const manager = new AgenticLoopManager({
    workspaceRoot: normalized.projectRoot,
    storageRoot
  });
  if (!manager.persistence.isEnabled()) {
    throw new Error(
      `MySQL-backed agentic persistence is disabled for ${normalized.projectRoot}. Set MYSQL_AGENTIC_ENABLED=1 and MYSQL_* connection vars.`
    );
  }

  const events = [];
  const result = await manager.orchestrateTask(normalized.payload, (event) => {
    if (events.length < 25) {
      events.push(event);
    }
  });

  const runId = result?.run?.id || "";
  const waitForFinal = options.waitForFinal === true;
  const waitTimeoutMsRaw = toFiniteNumber(options.waitTimeoutMs);
  const waitPollMsRaw = toFiniteNumber(options.waitPollMs);
  const waitTimeoutMs = waitTimeoutMsRaw && waitTimeoutMsRaw > 0 ? Number(waitTimeoutMsRaw) : 30 * 60 * 1000;
  const waitPollMs = waitPollMsRaw && waitPollMsRaw > 0 ? Math.max(250, Number(waitPollMsRaw)) : 2000;
  const terminalStatuses = new Set(["passed", "failed", "max_loops_reached", "cancelled", "completed"]);
  let finalRun = null;
  let waitTimedOut = false;
  let waitDurationMs = 0;

  if (waitForFinal && runId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitTimeoutMs) {
      const detail = await manager.getProjectTestRun(runId);
      if (!detail) {
        await sleep(waitPollMs);
        continue;
      }
      if (terminalStatuses.has(String(detail.status || ""))) {
        finalRun = detail;
        break;
      }
      await sleep(waitPollMs);
    }
    waitDurationMs = Date.now() - startedAt;
    waitTimedOut = !finalRun;
  }

  return {
    ok: true,
    requestId: normalized.requestId,
    projectRoot: normalized.projectRoot,
    result,
    events,
    wait: {
      enabled: waitForFinal,
      finalRun,
      pollMs: waitPollMs,
      runId,
      timedOut: waitTimedOut,
      timeoutMs: waitTimeoutMs,
      waitedMs: waitDurationMs
    }
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseArgs(argv);
    const request = readInput(parsed);
    const response = await runAgenticRequest(request, {
      storageRoot: parsed.storageRoot,
      waitForFinal: parsed.waitForFinal,
      waitTimeoutMs: parsed.waitTimeoutMs,
      waitPollMs: parsed.waitPollMs
    });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    if (response?.wait?.enabled && response?.wait?.timedOut) {
      process.exitCode = 2;
    }
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  normalizeRequest,
  parseArgs,
  readInput,
  runAgenticRequest
};
