const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildEnvironmentPlanningPrompt,
  deterministicEnvironmentPlan,
  ensureExecutionEnvironment,
  getProjectSignals,
  planExecutionEnvironment,
  probeUrl
} = require("../src/runtime/environment_planner");

function makeProject(root, packageJson, extraFiles = {}) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
  Object.entries(extraFiles).forEach(([name, content]) => {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  });
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-env-"));

  const webRoot = path.join(tmp, "web");
  makeProject(
    webRoot,
    {
      name: "web-app",
      scripts: {
        start: "node server.js"
      }
    },
    {
      "server.js": `
        const http = require("node:http");
        const server = http.createServer((req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
        });
        server.listen(process.env.TEST_PORT, "127.0.0.1");
      `
    }
  );

  const electronRoot = path.join(tmp, "electron");
  makeProject(
    electronRoot,
    {
      name: "electron-app",
      main: "src/main.js",
      scripts: {
        start: "electron ."
      },
      devDependencies: {
        electron: "^35.0.0"
      }
    },
    {
      "src/main.js": "module.exports = {};\n"
    }
  );

  const webSignals = getProjectSignals(webRoot);
  assert.equal(webSignals.projectName, "web-app");
  assert.equal(Boolean(webSignals.scripts.start), true);

  const webPlan = deterministicEnvironmentPlan({
    projectRoot: webRoot,
    input: {
      task: "Check landing page",
      targetType: "web_frontend",
      url: "http://127.0.0.1:43111"
    },
    signals: webSignals
  });
  assert.equal(webPlan.targetType, "web_frontend");
  assert.equal(webPlan.playwrightMode, "web");
  assert.equal(webPlan.startupCommand, "npm start");

  const electronSignals = getProjectSignals(electronRoot);
  const electronPlan = deterministicEnvironmentPlan({
    projectRoot: electronRoot,
    input: {
      task: "Check desktop app",
      targetType: "electron_app"
    },
    signals: electronSignals
  });
  assert.equal(electronPlan.targetType, "electron_app");
  assert.equal(electronPlan.playwrightMode, "electron");
  assert.equal(electronPlan.launchTarget.kind, "electron_app");
  assert.equal(electronPlan.launchTarget.value, electronRoot);

  const prompt = buildEnvironmentPlanningPrompt({
    projectRoot: electronRoot,
    input: { task: "Test desktop shell", targetType: "electron_app" },
    signals: electronSignals,
    targetType: "electron_app"
  });
  assert.match(prompt, /Allowed targetType values: web_frontend, electron_app/);
  assert.match(prompt, /Deterministic target guess: electron_app/);

  const plannedWeb = await planExecutionEnvironment({
    projectRoot: webRoot,
    input: {
      task: "Open landing page",
      targetType: "web_frontend",
      url: "http://127.0.0.1:43111"
    },
    openAiApiKey: "",
    fetchImpl: async () => {
      throw new Error("network should not be called without key");
    }
  });
  assert.equal(plannedWeb.targetType, "web_frontend");
  assert.equal(plannedWeb.playwrightMode, "web");

  const startupPlan = {
    ...webPlan,
    startupCommand: `"${process.execPath}" server.js`,
    startupCwd: webRoot,
    readiness: {
      kind: "url",
      target: "http://127.0.0.1:43111"
    },
    launchTarget: {
      kind: "url",
      value: "http://127.0.0.1:43111"
    }
  };
  const session = await ensureExecutionEnvironment(startupPlan, {
    env: { TEST_PORT: "43111" },
    readinessTimeoutMs: 8000
  });
  assert.equal(session.started, true);
  assert.equal(await probeUrl("http://127.0.0.1:43111", 1200), true);
  await session.cleanup();
  if (session.child && session.child.exitCode === null) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(session.child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      session.child.kill("SIGTERM");
    }
  }

  const noBootSession = await ensureExecutionEnvironment(electronPlan);
  assert.equal(noBootSession.started, false);
  await noBootSession.cleanup();

  console.log("environment_planner.test.js passed");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
