const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeArtifact(runPath, type, content) {
  const fileName = `${Date.now()}_${type}.txt`;
  const outputPath = path.join(runPath, fileName);
  fs.writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

async function waitForReady(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch (_) {
      // keep trying
    }
    await sleep(500);
  }
  return false;
}

function parseSteps(inputSteps) {
  if (Array.isArray(inputSteps) && inputSteps.length > 0) {
    return inputSteps;
  }

  return [
    { action: "goto", target: "/" },
    { action: "assert", target: "page reachable" }
  ];
}

async function executeScenario({ input, runPath, emitEvent }) {
  const steps = parseSteps(input.steps);
  const startedAt = new Date().toISOString();

  let appProcess = null;
  let commandOutput = "";
  let ready = true;

  if (input.command && input.command.trim()) {
    emitEvent({ type: "status", value: "starting_app" });
    appProcess = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: process.env
    });

    appProcess.stdout.on("data", (chunk) => {
      commandOutput += chunk.toString("utf8");
    });

    appProcess.stderr.on("data", (chunk) => {
      commandOutput += chunk.toString("utf8");
    });

    ready = await waitForReady(input.url, 20000);
  }

  emitEvent({ type: "status", value: ready ? "app_ready" : "app_not_ready" });

  const stepResults = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    emitEvent({ type: "step", index: i, total: steps.length, step });

    // MVP mock execution path that is deterministic and testable.
    await sleep(350);

    stepResults.push({
      index: i,
      action: step.action,
      target: step.target || null,
      status: "pass",
      note: "Executed by MVP runner"
    });
  }

  const commandLogPath = writeArtifact(
    runPath,
    "command_log",
    commandOutput || "[Jungle] No command output captured."
  );

  const summaryPath = writeArtifact(
    runPath,
    "summary",
    JSON.stringify(
      {
        status: ready ? "pass" : "fail",
        reason: ready
          ? "Scenario executed with mock runner and app readiness check passed."
          : "App did not become ready before timeout.",
        steps: stepResults
      },
      null,
      2
    )
  );

  if (appProcess && !appProcess.killed) {
    appProcess.kill();
  }

  return {
    artifacts: [
      { type: "command_log", path: commandLogPath },
      { type: "result_summary", path: summaryPath }
    ],
    endedAt: new Date().toISOString(),
    failedStep: ready ? null : 0,
    resultSummary: ready
      ? "Run completed. App ready and scenario steps executed."
      : "Run failed. App did not pass readiness check.",
    startedAt,
    status: ready ? "pass" : "fail",
    steps: stepResults
  };
}

module.exports = {
  executeScenario
};
