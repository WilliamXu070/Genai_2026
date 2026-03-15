const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pty = require("node-pty");
const { JungleManager } = require("./runtime/manager");
const { runOperationalExample } = require("./runtime/operational_example");
const { AgenticLoopManager } = require("./runtime/agentic_loop");
const { CatalogService } = require("./catalog/service");

let mainWindow;
const terminalSessions = new Map();
let jungleManager;
let agenticLoopManager;
let catalogService;

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getProjectRoot() {
  return app.getAppPath();
}

function disposeTerminalSession() {
  for (const session of terminalSessions.values()) {
    try {
      session.process.kill();
    } catch (_) {
      // ignore process disposal failures
    }
  }
  terminalSessions.clear();
}

function createTerminalSession(webContents, options = {}) {
  const shellPath =
    process.platform === "win32"
      ? process.env.COMSPEC || "cmd.exe"
      : process.env.SHELL || "/bin/zsh";
  const sessionId = `terminal-${Date.now()}`;
  const projectRoot = getProjectRoot();
  const shellName = path.basename(shellPath);
  const cols = Number.isInteger(options.cols) ? Math.max(20, options.cols) : 120;
  const rows = Number.isInteger(options.rows) ? Math.max(8, options.rows) : 34;
  let args = process.platform === "win32" ? ["/Q"] : ["-i"];

  if (shellName === "zsh") {
    args = ["-i", "-f"];
  } else if (shellName === "bash") {
    args = ["--noprofile", "--norc", "-i"];
  }

  const terminalProcess = pty.spawn(shellPath, args, {
    cols,
    cwd: projectRoot,
    name: "xterm-256color",
    rows,
    env: {
      ...process.env,
      COLORTERM: "truecolor",
      HISTFILE: path.join(os.tmpdir(), "jungle_shell_history"),
      JUNGLE_PROJECT_ROOT: projectRoot,
      LANG: process.env.LANG || "en_US.UTF-8",
      TERM: "xterm-256color"
    }
  });

  const session = {
    cwd: projectRoot,
    id: sessionId,
    process: terminalProcess,
    shellPath,
    webContentsId: webContents.id,
    cols,
    rows
  };
  terminalSessions.set(sessionId, session);

  const sendToRenderer = (channel, payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, payload);
    }
  };

  terminalProcess.onData((chunk) => {
    sendToRenderer("terminal:data", {
      data: chunk,
      sessionId
    });
  });

  terminalProcess.onExit(({ exitCode, signal }) => {
    sendToRenderer("terminal:exit", {
      code: exitCode,
      sessionId,
      signal
    });

    terminalSessions.delete(sessionId);
  });

  return session;
}

function disposeSingleTerminalSession(sessionId, senderId) {
  if (!sessionId) {
    return false;
  }
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return false;
  }
  if (senderId && senderId !== session.webContentsId) {
    return false;
  }
  try {
    session.process.kill();
  } catch (_) {
    // ignore process disposal failures
  }
  terminalSessions.delete(sessionId);
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: "#08110d",
    title: "Jungle",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "v2", "index.html"));

  mainWindow.on("closed", () => {
    disposeTerminalSession();
    mainWindow = null;
  });
}

async function runToolBridgeIfConfigured() {
  const requestPath = process.env.JUNGLE_TOOL_REQUEST_PATH;
  const responsePath = process.env.JUNGLE_TOOL_RESPONSE_PATH;
  if (!requestPath || !responsePath) {
    return;
  }

  let response;
  try {
    const request = readJsonFile(requestPath);
    const type = request?.type || "jungle:start-run";
    const payload = request?.payload || {};
    const requestId = request?.requestId || `req_${Date.now()}`;

    if (type !== "jungle:start-run") {
      throw new Error(`Unsupported tool request type: ${type}`);
    }

    const result = await jungleManager.startRun(
      {
        command: "",
        projectName: payload.projectName || "Jungle",
        scenarioName: payload.scenarioName || "Tool bridge smoke",
        steps:
          Array.isArray(payload.steps) && payload.steps.length > 0
            ? payload.steps
            : [{ action: "assert", target: "tool request received" }],
        url: payload.url || "http://127.0.0.1:3000"
      },
      (runtimeEvent) => {
        if (!mainWindow?.webContents.isDestroyed()) {
          mainWindow.webContents.send("jungle:run-event", runtimeEvent);
        }
      }
    );

    response = {
      completedAt: new Date().toISOString(),
      ok: true,
      requestId,
      result
    };
  } catch (error) {
    response = {
      completedAt: new Date().toISOString(),
      error: error.message,
      ok: false,
      requestId: null
    };
  }

  writeJsonFile(responsePath, response);

  if (process.env.JUNGLE_TOOL_EXIT_ON_COMPLETE === "1") {
    setTimeout(() => {
      app.quit();
    }, 250);
  }
}

app.whenReady().then(() => {
  app.setName("Jungle");
  jungleManager = new JungleManager(getProjectRoot());
  agenticLoopManager = new AgenticLoopManager(getProjectRoot());
  catalogService = new CatalogService(getProjectRoot());
  createWindow();
  runToolBridgeIfConfigured();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  disposeTerminalSession();
});

ipcMain.handle("terminal:create", (event, options) => {
  const session = createTerminalSession(event.sender, options || {});

  return {
    cols: session.cols,
    cwd: session.cwd,
    home: os.homedir(),
    rows: session.rows,
    sessionId: session.id,
    shellPath: session.shellPath
  };
});

ipcMain.on("terminal:input", (event, payload) => {
  if (!payload?.sessionId) {
    return;
  }
  const session = terminalSessions.get(payload.sessionId);
  if (!session) {
    return;
  }

  if (event.sender.id !== session.webContentsId) {
    return;
  }

  session.process.write(payload.data);
});

ipcMain.on("terminal:resize", (event, payload) => {
  if (!payload?.sessionId) {
    return;
  }
  const session = terminalSessions.get(payload.sessionId);
  if (!session) {
    return;
  }

  if (event.sender.id !== session.webContentsId) {
    return;
  }

  const cols = Number.isInteger(payload.cols) ? Math.max(20, payload.cols) : null;
  const rows = Number.isInteger(payload.rows) ? Math.max(8, payload.rows) : null;

  if (!cols || !rows) {
    return;
  }

  session.cols = cols;
  session.rows = rows;
  session.process.resize(cols, rows);
});

ipcMain.handle("terminal:dispose", (event, sessionId) => {
  return disposeSingleTerminalSession(sessionId, event.sender.id);
});

ipcMain.handle("jungle:list-runs", () => {
  return jungleManager ? jungleManager.listRuns(25) : [];
});

ipcMain.handle("jungle:get-todo-blueprint", () => {
  if (!jungleManager) {
    return { completed: [], blankBoxes: [] };
  }
  return jungleManager.getTodoBlueprint();
});

ipcMain.handle("jungle:start-run", async (event, payload) => {
  if (!jungleManager) {
    throw new Error("Jungle runtime manager is not initialized.");
  }

  const emitEvent = (runtimeEvent) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("jungle:run-event", runtimeEvent);
    }
  };

  return jungleManager.startRun(payload || {}, emitEvent);
});

ipcMain.handle("jungle:run-operational-example", async () => {
  return runOperationalExample(getProjectRoot());
});

ipcMain.handle("jungle:orchestrate-task", async (event, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }

  const emitEvent = (runtimeEvent) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("agentic:event", runtimeEvent);
    }
  };

  return agenticLoopManager.orchestrateTask(payload || {}, emitEvent);
});

ipcMain.handle("agentic:list-forests", () => {
  return agenticLoopManager ? agenticLoopManager.listForests() : [];
});

ipcMain.handle("agentic:list-trees", (_, forestId) => {
  return agenticLoopManager && forestId ? agenticLoopManager.listTrees(forestId) : [];
});

ipcMain.handle("agentic:list-runs", (_, forestId) => {
  return agenticLoopManager ? agenticLoopManager.listRuns(forestId) : [];
});

ipcMain.handle("agentic:list-projects", async () => {
  return agenticLoopManager ? agenticLoopManager.listProjects() : [];
});

ipcMain.handle("agentic:list-awaiting-approval-runs", async (_, projectId) => {
  return agenticLoopManager ? agenticLoopManager.listAwaitingApprovalRuns(projectId || null) : [];
});

ipcMain.handle("agentic:list-in-progress-runs", async (_, projectId) => {
  return agenticLoopManager ? agenticLoopManager.listInProgressRuns(projectId || null) : [];
});

ipcMain.handle("agentic:list-project-test-runs", async (_, projectId) => {
  return agenticLoopManager && projectId ? agenticLoopManager.listProjectTestRuns(projectId) : [];
});

ipcMain.handle("agentic:get-project-test-run", async (_, runId) => {
  return agenticLoopManager && runId ? agenticLoopManager.getProjectTestRun(runId) : null;
});

ipcMain.handle("agentic:approve-run", async (_, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  return agenticLoopManager.approveRun(payload || {});
});

ipcMain.handle("agentic:update-run-testing-instructions", async (_, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  return agenticLoopManager.updateRunTestingInstructions(payload || {});
});

ipcMain.handle("agentic:create-variant-run", async (_, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  return agenticLoopManager.createVariantRun(payload || {});
});

ipcMain.handle("agentic:cancel-run", async (_, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  return agenticLoopManager.cancelRun(payload || {});
});

ipcMain.handle("agentic:create-draft", async (_, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  return agenticLoopManager.createDraft(payload || {});
});

ipcMain.handle("agentic:orchestrate-task", async (event, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  const emitEvent = (runtimeEvent) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("agentic:event", runtimeEvent);
    }
  };
  return agenticLoopManager.orchestrateTask(payload || {}, emitEvent);
});

ipcMain.handle("agentic:confirm-and-run", async (event, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  const emitEvent = (runtimeEvent) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("agentic:event", runtimeEvent);
    }
  };
  return agenticLoopManager.confirmAndRun(payload || {}, emitEvent);
});

ipcMain.handle("agentic:redo-run", async (event, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  const emitEvent = (runtimeEvent) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("agentic:event", runtimeEvent);
    }
  };
  return agenticLoopManager.redoRun(payload || {}, emitEvent);
});

ipcMain.handle("agentic:fork-tree", async (_, payload) => {
  if (!agenticLoopManager) {
    throw new Error("Agentic loop manager unavailable");
  }
  return agenticLoopManager.forkTree(payload || {});
});

ipcMain.handle("catalog:list-tests", () => {
  if (!catalogService) {
    return [];
  }
  return catalogService.listTests();
});

ipcMain.handle("catalog:get-test", (_, testId) => {
  if (!catalogService) {
    return null;
  }
  return catalogService.getTest(testId);
});

ipcMain.handle("catalog:update-test", (_, payload) => {
  if (!catalogService) {
    throw new Error("Catalog service unavailable");
  }
  return catalogService.updateTest(payload || {});
});

ipcMain.handle("catalog:regenerate-test", (_, payload) => {
  if (!catalogService) {
    throw new Error("Catalog service unavailable");
  }
  return catalogService.regenerateTest(payload || {});
});
