const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { toFixPacket } = require("./feedback");

function parseArgs(argv) {
  const args = [...argv];
  const out = {
    task: "",
    url: "",
    workspace: "",
    maxIterations: 5,
    severityThreshold: 8.0,
    maxRetries: 2,
    codexCommand: "",
    timeoutMs: 240000
  };

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--task") out.task = args.shift() || "";
    else if (token === "--url") out.url = args.shift() || "";
    else if (token === "--workspace") out.workspace = args.shift() || "";
    else if (token === "--max-iterations") out.maxIterations = Number(args.shift() || "5");
    else if (token === "--severity-threshold") out.severityThreshold = Number(args.shift() || "8");
    else if (token === "--max-retries") out.maxRetries = Number(args.shift() || "2");
    else if (token === "--codex-command") out.codexCommand = args.shift() || "";
    else if (token === "--timeout-ms") out.timeoutMs = Number(args.shift() || "240000");
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!out.task.trim()) throw new Error("Missing required --task");
  if (!out.url.trim()) throw new Error("Missing required --url");
  return out;
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
      stdout += chunk.toString("utf8");
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
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

function parseBridgeJson(stdout) {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((v) => v.trim().startsWith("{"));
  if (!line) throw new Error("Bridge returned no JSON payload");
  return JSON.parse(line);
}

async function runLoop() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const workspace = args.workspace ? path.resolve(args.workspace) : repoRoot;
  const runRoot = path.join(__dirname, "runs", `cli_loop_${Date.now()}`);
  ensureDir(runRoot);

  let lastFixPacket = null;
  let final = null;

  for (let iteration = 1; iteration <= args.maxIterations; iteration += 1) {
    const iterationDir = path.join(runRoot, `iteration_${iteration}`);
    ensureDir(iterationDir);

    if (args.codexCommand) {
      const feedbackPath = path.join(iterationDir, "feedback_input.json");
      fs.writeFileSync(feedbackPath, JSON.stringify(lastFixPacket || {}, null, 2), "utf8");
      const cmd = args.codexCommand
        .replaceAll("{{workspace}}", workspace)
        .replaceAll("{{iteration}}", String(iteration))
        .replaceAll("{{feedback_file}}", feedbackPath);

      const codexResult = await runCommand(cmd, workspace, args.timeoutMs, {
        ...process.env,
        CODEX_LOOP_TASK: args.task,
        CODEX_LOOP_URL: args.url,
        CODEX_LOOP_ITERATION: String(iteration),
        CODEX_LOOP_FEEDBACK_PATH: feedbackPath
      });
      fs.writeFileSync(path.join(iterationDir, "codex_command_result.json"), JSON.stringify(codexResult, null, 2), "utf8");
    }

    const requestPayload = {
      requestId: `cli_loop_${Date.now()}_${iteration}`,
      type: "jungle:start-run",
      payload: {
        objective: args.task,
        url: args.url,
        projectRoot: repoRoot,
        environmentContext: `CLI Codex feedback loop iteration ${iteration}`,
        constraints: "Terminal-only loop. No UI interaction required.",
        severityThreshold: args.severityThreshold,
        maxRetries: args.maxRetries
      }
    };
    const requestPath = path.join(iterationDir, "bridge_request.json");
    fs.writeFileSync(requestPath, JSON.stringify(requestPayload, null, 2), "utf8");

    const bridgeCmd = `node Testing/tools/jungle_tool_bridge.js --mode langflow-cli --input-file "${requestPath}" --timeout-ms ${args.timeoutMs}`;
    const bridgeResult = await runCommand(bridgeCmd, repoRoot, args.timeoutMs);
    const parsedBridge = parseBridgeJson(bridgeResult.stdout);
    fs.writeFileSync(path.join(iterationDir, "bridge_response.json"), JSON.stringify(parsedBridge, null, 2), "utf8");

    const orchestration = parsedBridge?.result || {};
    const fixPacket = toFixPacket(orchestration, iteration);
    fs.writeFileSync(path.join(iterationDir, "fix_packet.json"), JSON.stringify(fixPacket, null, 2), "utf8");
    lastFixPacket = fixPacket;

    final = {
      iteration,
      orchestration,
      fixPacket,
      runRoot
    };

    if (!fixPacket.needsFix) {
      break;
    }
  }

  const out = {
    status: final?.fixPacket?.needsFix ? "max_iterations_reached" : "pass",
    runRoot,
    finalIteration: final?.iteration || 0,
    finalVerdict: final?.orchestration?.final_verdict || "fail",
    fixPacket: final?.fixPacket || null
  };
  fs.writeFileSync(path.join(runRoot, "loop_summary.json"), JSON.stringify(out, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

if (require.main === module) {
  runLoop().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
