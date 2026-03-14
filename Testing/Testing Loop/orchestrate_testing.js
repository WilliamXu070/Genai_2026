const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { toFixPacket } = require("../cli_agentic_loop/feedback");

function parseArgs(argv) {
  const args = [...argv];
  const out = {
    inputFile: "",
    inputJson: "",
    inputStdin: false,
    maxIterations: 5,
    timeoutMs: 240000,
    codexFixCmd: "",
    projectRoot: "",
    skipCodexFix: false
  };

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--input-file") out.inputFile = args.shift() || "";
    else if (token === "--input-json") out.inputJson = args.shift() || "";
    else if (token === "--input-stdin") out.inputStdin = true;
    else if (token === "--max-iterations") out.maxIterations = Number(args.shift() || "5");
    else if (token === "--timeout-ms") out.timeoutMs = Number(args.shift() || "240000");
    else if (token === "--codex-fix-cmd") out.codexFixCmd = args.shift() || "";
    else if (token === "--project-root") out.projectRoot = args.shift() || "";
    else if (token === "--skip-codex-fix") out.skipCodexFix = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return out;
}

function readPayload(parsed) {
  if (parsed.inputFile) {
    return JSON.parse(fs.readFileSync(path.resolve(parsed.inputFile), "utf8"));
  }
  if (parsed.inputStdin) {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  }
  if (parsed.inputJson) {
    return JSON.parse(parsed.inputJson);
  }
  throw new Error("Provide one of --input-file, --input-json, or --input-stdin");
}

function validateLangflowInput(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: ["payload must be a JSON object"] };
  }

  if (!payload.target_url || typeof payload.target_url !== "string" || !payload.target_url.trim()) {
    errors.push("target_url is required and must be a non-empty string");
  }
  if (payload.severity_threshold !== undefined) {
    const n = Number(payload.severity_threshold);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      errors.push("severity_threshold must be a number between 0 and 10");
    }
  }
  if (payload.max_retries !== undefined) {
    const n = Number(payload.max_retries);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      errors.push("max_retries must be a number between 0 and 10");
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizePayload(payload, repoRoot, argProjectRoot) {
  return {
    feature_goal:
      typeof payload.feature_goal === "string" && payload.feature_goal.trim()
        ? payload.feature_goal.trim()
        : "Validate feature behavior",
    target_url: String(payload.target_url || "").trim(),
    environment_context: typeof payload.environment_context === "string" ? payload.environment_context : "",
    constraints: typeof payload.constraints === "string" ? payload.constraints : "",
    severity_threshold:
      payload.severity_threshold === undefined ? 8.0 : Math.max(0, Math.min(10, Number(payload.severity_threshold))),
    max_retries: payload.max_retries === undefined ? 2 : Math.max(0, Math.min(10, Number(payload.max_retries))),
    project_root: argProjectRoot || payload.project_root || repoRoot
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runCommand(command, cwd, timeoutMs, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true });
    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        // ignore
      }
      finish(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const s = chunk.toString("utf8");
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString("utf8");
      stderr += s;
      process.stderr.write(s);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(null, { code, stdout, stderr });
    });
  });
}

function parseBridgeOutput(stdout) {
  const jsonLine = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    throw new Error("Bridge returned no JSON output");
  }
  const parsed = JSON.parse(jsonLine);
  if (!parsed || parsed.ok !== true || !parsed.result) {
    throw new Error("Bridge returned invalid response payload");
  }
  return parsed;
}

function buildBridgeRequest(input, iteration) {
  return {
    requestId: `orchestrate_testing_${Date.now()}_${iteration}`,
    type: "jungle:start-run",
    payload: {
      objective: input.feature_goal,
      url: input.target_url,
      projectRoot: input.project_root,
      environmentContext: input.environment_context,
      constraints: input.constraints,
      severityThreshold: input.severity_threshold,
      maxRetries: input.max_retries
    }
  };
}

function shouldStop(orchestration) {
  return orchestration?.final_verdict === "pass" && orchestration?.execution?.status === "pass" && !orchestration?.escalated;
}

function defaultCodexFixCmd() {
  return 'codex exec "Read {{feedback_file}} and apply code fixes in {{workspace}} so tests pass."';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const raw = readPayload(args);
  const check = validateLangflowInput(raw);
  if (!check.valid) {
    throw new Error(`Invalid orchestrate_testing input: ${check.errors.join("; ")}`);
  }
  const input = normalizePayload(raw, repoRoot, args.projectRoot);

  const runRoot = path.join(__dirname, "runs", `orchestrate_testing_${Date.now()}`);
  ensureDir(runRoot);
  fs.writeFileSync(path.join(runRoot, "input.json"), JSON.stringify(input, null, 2), "utf8");

  let lastFixPacket = null;
  let final = null;
  const fixCmdTemplate = (args.codexFixCmd || "").trim();

  for (let iteration = 1; iteration <= args.maxIterations; iteration += 1) {
    const iterDir = path.join(runRoot, `iteration_${iteration}`);
    ensureDir(iterDir);

    const requestPayload = buildBridgeRequest(input, iteration);
    const requestPath = path.join(iterDir, "bridge_request.json");
    fs.writeFileSync(requestPath, JSON.stringify(requestPayload, null, 2), "utf8");

    const bridgeCommand = `node Testing/tools/jungle_tool_bridge.js --mode langflow-cli --input-file "${requestPath}" --timeout-ms ${args.timeoutMs}`;
    const bridgeResult = await runCommand(bridgeCommand, repoRoot, args.timeoutMs);
    fs.writeFileSync(path.join(iterDir, "bridge_stdout.log"), bridgeResult.stdout || "", "utf8");
    fs.writeFileSync(path.join(iterDir, "bridge_stderr.log"), bridgeResult.stderr || "", "utf8");
    const bridgeOutput = parseBridgeOutput(bridgeResult.stdout || "");
    fs.writeFileSync(path.join(iterDir, "bridge_response.json"), JSON.stringify(bridgeOutput, null, 2), "utf8");

    const orchestration = bridgeOutput.result;
    const fixPacket = toFixPacket(orchestration, iteration);
    fs.writeFileSync(path.join(iterDir, "fix_packet.json"), JSON.stringify(fixPacket, null, 2), "utf8");
    lastFixPacket = fixPacket;

    final = {
      iteration,
      orchestration,
      fixPacket
    };

    if (shouldStop(orchestration)) {
      break;
    }

    const feedbackPath = path.join(iterDir, "feedback_input.json");
    fs.writeFileSync(feedbackPath, JSON.stringify(lastFixPacket, null, 2), "utf8");

    if (!args.skipCodexFix) {
      const fixCommandTemplate = fixCmdTemplate || defaultCodexFixCmd();
      const fixCommand = fixCommandTemplate
        .replaceAll("{{workspace}}", input.project_root)
        .replaceAll("{{iteration}}", String(iteration))
        .replaceAll("{{feedback_file}}", feedbackPath)
        .replaceAll("{{feature_goal}}", input.feature_goal);

      const fixResult = await runCommand(fixCommand, input.project_root, args.timeoutMs, {
        ...process.env,
        ORCHESTRATE_TESTING_RUN_ROOT: runRoot,
        ORCHESTRATE_TESTING_ITERATION: String(iteration),
        ORCHESTRATE_TESTING_FEEDBACK_PATH: feedbackPath,
        ORCHESTRATE_TESTING_TARGET_URL: input.target_url,
        ORCHESTRATE_TESTING_FEATURE_GOAL: input.feature_goal
      });
      fs.writeFileSync(path.join(iterDir, "codex_fix_result.json"), JSON.stringify(fixResult, null, 2), "utf8");
    }
  }

  const summary = {
    status: shouldStop(final?.orchestration) ? "pass" : "max_iterations_reached",
    runRoot,
    finalIteration: final?.iteration || 0,
    finalVerdict: final?.orchestration?.final_verdict || "fail",
    executionStatus: final?.orchestration?.execution?.status || "fail",
    escalated: Boolean(final?.orchestration?.escalated),
    severity: Number(final?.orchestration?.critique?.overall_severity || 0),
    fixPacket: final?.fixPacket || null
  };
  fs.writeFileSync(path.join(runRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
