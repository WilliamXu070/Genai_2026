const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { JungleManager } = require("../../src/runtime/manager");
const {
  normalizeBridgeRequest,
  validateBridgeRequest,
  validateOrchestratorResponse
} = require("../cli_agentic_loop/tool_contract");

function parseStepToken(token) {
  if (!token) {
    return { action: "assert", target: "" };
  }

  const trimmed = String(token).trim();
  if (!trimmed) {
    return { action: "assert", target: "" };
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const separator = trimmed.indexOf(":");
  if (separator === -1) {
    return { action: "assert", target: trimmed };
  }

  const action = trimmed.slice(0, separator).trim() || "assert";
  const target = trimmed.slice(separator + 1).trim();
  return { action, target };
}

function parseArgs(argv) {
  const args = [...argv];
  let inputStdin = false;
  let inputJson = "";
  let inputFile = "";
  let requestId = "";
  let type = "jungle:start-run";
  let projectName = "";
  let scenarioName = "";
  let url = "";
  const steps = [];
  let mode = "headless";
  let keepOpen = false;
  let uiWaitMs = 0;
  let storageRoot = "";
  let timeoutMs = 90000;

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--input-stdin") {
      inputStdin = true;
      continue;
    }
    if (token === "--input-json") {
      inputJson = args.shift() || "";
      continue;
    }
    if (token === "--input-file") {
      inputFile = args.shift() || "";
      continue;
    }
    if (token === "--request-id") {
      requestId = args.shift() || "";
      continue;
    }
    if (token === "--type") {
      type = args.shift() || "jungle:start-run";
      continue;
    }
    if (token === "--project-name") {
      projectName = args.shift() || "";
      continue;
    }
    if (token === "--scenario-name") {
      scenarioName = args.shift() || "";
      continue;
    }
    if (token === "--url") {
      url = args.shift() || "";
      continue;
    }
    if (token === "--step") {
      const stepToken = args.shift() || "";
      steps.push(parseStepToken(stepToken));
      continue;
    }
    if (token === "--timeout-ms") {
      timeoutMs = Number(args.shift() || "90000");
      continue;
    }
    if (token === "--mode") {
      mode = args.shift() || "headless";
      continue;
    }
    if (token === "--keep-open") {
      keepOpen = true;
      continue;
    }
    if (token === "--ui-wait-ms") {
      uiWaitMs = Number(args.shift() || "0");
      continue;
    }
    if (token === "--storage-root") {
      storageRoot = args.shift() || "";
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!inputJson && !inputFile && !inputStdin && !requestId) {
    throw new Error(
      "Provide --input-json, --input-file, --input-stdin, or --request-id/--scenario-name shorthand flags"
    );
  }

  let inlineRequest = null;
  if (requestId || scenarioName || projectName || url || steps.length > 0) {
    inlineRequest = {
      requestId: requestId || `req_${Date.now()}`,
      type: type || "jungle:start-run",
      payload: {}
    };

    if (projectName) {
      inlineRequest.payload.projectName = projectName;
    }
    if (scenarioName) {
      inlineRequest.payload.scenarioName = scenarioName;
    }
    if (url) {
      inlineRequest.payload.url = url;
    }
    if (steps.length > 0) {
      inlineRequest.payload.steps = steps;
    }
  }

  return {
    inputFile,
    inputJson,
    inputStdin,
    inlineRequest,
    timeoutMs,
    mode,
    keepOpen,
    uiWaitMs,
    storageRoot
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
    const stdin = fs.readFileSync(0, "utf8");
    return JSON.parse(stdin);
  }
  return JSON.parse(inputJson);
}

function waitForFile(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for response at ${filePath}`));
      }
    }, 200);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runLangflowAgentic(request, repoRoot, timeoutMs) {
  return new Promise((resolve, reject) => {
    const check = validateBridgeRequest(request);
    if (!check.valid) {
      reject(new Error(`Invalid tool request schema: ${check.errors.join("; ")}`));
      return;
    }
    const payload = normalizeBridgeRequest(request, repoRoot);
    const tmpDir = path.join(repoRoot, "Testing", ".jungle_tool_io");
    fs.mkdirSync(tmpDir, { recursive: true });
    const payloadPath = path.join(tmpDir, `langflow_payload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");
    const child = spawn(
      "py",
      ["-m", "langflow_orchestrator.pipeline.agentic_cli", "--input-file", payloadPath],
      {
        cwd: repoRoot,
        env: process.env,
        shell: true
      }
    );

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        // ignore
      }
      finish(new Error(`Timed out waiting for Langflow orchestrator response after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        fs.unlinkSync(payloadPath);
      } catch (_) {
        // ignore cleanup failures
      }
      if (code !== 0) {
        finish(new Error(stderr || `Langflow CLI exited with code ${code}`));
        return;
      }
      const line = stdout
        .trim()
        .split(/\r?\n/)
        .reverse()
        .find((v) => v.trim().startsWith("{"));
      if (!line) {
        finish(new Error("Langflow CLI returned no JSON output"));
        return;
      }
      try {
        const parsed = JSON.parse(line);
        const responseCheck = validateOrchestratorResponse(parsed);
        if (!responseCheck.valid) {
          finish(new Error(`Invalid orchestrator response schema: ${responseCheck.errors.join("; ")}`));
          return;
        }
        finish(null, parsed);
      } catch (error) {
        finish(new Error(`Failed to parse Langflow CLI output: ${error.message}`));
      }
    });
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const request = readInput(parsed);

  const repoRoot = path.resolve(__dirname, "..", "..");
  const testingRoot = path.resolve(__dirname, "..");
  const effectiveStorageRoot = parsed.storageRoot
    ? path.resolve(parsed.storageRoot)
    : process.cwd().toLowerCase().includes(`${path.sep}testing`)
      ? testingRoot
      : repoRoot;
  let response;

  if (parsed.mode === "electron") {
    const ioDir = path.join(repoRoot, "Testing", ".jungle_tool_io");
    fs.mkdirSync(ioDir, { recursive: true });

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const requestPath = path.join(ioDir, `request_${suffix}.json`);
    const responsePath = path.join(ioDir, `response_${suffix}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf8");

    const electronBinary = require("electron");
    const child = spawn(electronBinary, [repoRoot], {
      cwd: repoRoot,
      env: {
        ...process.env,
        JUNGLE_TOOL_EXIT_ON_COMPLETE: parsed.keepOpen ? "0" : "1",
        JUNGLE_TOOL_REQUEST_PATH: requestPath,
        JUNGLE_TOOL_RESPONSE_PATH: responsePath
      },
      detached: parsed.keepOpen,
      stdio: "ignore"
    });

    await waitForFile(responsePath, parsed.timeoutMs);
    response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
    const waitMs = Number.isFinite(parsed.uiWaitMs) && parsed.uiWaitMs >= 0 ? parsed.uiWaitMs : 0;
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    if (parsed.keepOpen) {
      // Allow this CLI process to exit while leaving the Electron window alive.
      child.unref();
    } else if (!child.killed) {
      child.kill();
    }
  } else if (parsed.mode === "langflow-cli") {
    response = {
      completedAt: new Date().toISOString(),
      ok: true,
      requestId: request?.requestId || `req_${Date.now()}`,
      result: await runLangflowAgentic(request, repoRoot, parsed.timeoutMs)
    };
  } else {
    if ((request?.type || "jungle:start-run") !== "jungle:start-run") {
      throw new Error(`Unsupported tool request type: ${request?.type}`);
    }

    const manager = new JungleManager(effectiveStorageRoot);
    const result = await manager.startRun(
      {
        command: "",
        projectName: request?.payload?.projectName || "Jungle",
        scenarioName: request?.payload?.scenarioName || "Tool bridge smoke",
        steps:
          Array.isArray(request?.payload?.steps) && request.payload.steps.length > 0
            ? request.payload.steps
            : [{ action: "assert", target: "tool request received" }],
        url: request?.payload?.url || "http://127.0.0.1:3000"
      },
      () => {}
    );

    response = {
      completedAt: new Date().toISOString(),
      ok: true,
      requestId: request?.requestId || `req_${Date.now()}`,
      result
    };
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs
};
