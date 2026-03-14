const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { JungleManager } = require("./runtime/manager");

let mainWindow;
let terminalSession;
let jungleManager;

function getProjectRoot() {
  return app.getAppPath();
}

function disposeTerminalSession() {
  if (terminalSession?.process && !terminalSession.process.killed) {
    terminalSession.process.kill();
  }

  terminalSession = null;
}

function createTerminalSession(webContents) {
  if (terminalSession && !terminalSession.process.killed) {
    return terminalSession;
  }

  const shellPath = process.env.SHELL || "/bin/zsh";
  const sessionId = `terminal-${Date.now()}`;
  const projectRoot = getProjectRoot();
  const shellName = path.basename(shellPath);
  let args = [];

  if (process.platform === "win32") {
    args = [];
  } else if (shellName === "zsh") {
    args = ["-i", "-f"];
  } else if (shellName === "bash") {
    args = ["--noprofile", "--norc", "-i"];
  } else {
    args = ["-i"];
  }

  const terminalProcess = spawn(shellPath, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      COLORTERM: "truecolor",
      HISTFILE: path.join(os.tmpdir(), "jungle_shell_history"),
      JUNGLE_PROJECT_ROOT: projectRoot,
      LANG: process.env.LANG || "en_US.UTF-8",
      TERM: "xterm-256color"
    }
  });

  terminalSession = {
    cwd: projectRoot,
    id: sessionId,
    process: terminalProcess,
    shellPath,
    webContentsId: webContents.id
  };

  const sendToRenderer = (channel, payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, payload);
    }
  };

  terminalProcess.stdout.on("data", (chunk) => {
    sendToRenderer("terminal:data", {
      data: chunk.toString("utf8"),
      sessionId
    });
  });

  terminalProcess.stderr.on("data", (chunk) => {
    sendToRenderer("terminal:data", {
      data: chunk.toString("utf8"),
      sessionId
    });
  });

  terminalProcess.on("close", (code, signal) => {
    sendToRenderer("terminal:exit", {
      code,
      sessionId,
      signal
    });

    if (terminalSession?.id === sessionId) {
      terminalSession = null;
    }
  });

  terminalProcess.on("error", (error) => {
    sendToRenderer("terminal:data", {
      data: `\r\n[Jungle] Terminal failed to start: ${error.message}\r\n`,
      sessionId
    });
  });

  setTimeout(() => {
    if (terminalSession?.id === sessionId) {
      if (shellName === "zsh") {
        terminalProcess.stdin.write("PROMPT=$'\\033[1;32mjungle\\033[0m % '\r");
      } else if (shellName === "bash") {
        terminalProcess.stdin.write("export PS1='jungle % '\r");
      }

      terminalProcess.stdin.write("clear\r");
      terminalProcess.stdin.write(
        `printf '\\033[1;32mJungle terminal attached.\\033[0m\\nProject: %s\\nShell: %s\\n\\n' "${projectRoot}" "${shellName}"\r`
      );
    }
  }, 180);

  return terminalSession;
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
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    disposeTerminalSession();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setName("Jungle");
  jungleManager = new JungleManager(getProjectRoot());
  createWindow();

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

ipcMain.handle("terminal:create", (event) => {
  const session = createTerminalSession(event.sender);

  return {
    cwd: session.cwd,
    home: os.homedir(),
    sessionId: session.id,
    shellPath: session.shellPath
  };
});

ipcMain.on("terminal:input", (event, payload) => {
  if (!payload || payload.sessionId !== terminalSession?.id) {
    return;
  }

  if (event.sender.id !== terminalSession.webContentsId) {
    return;
  }

  terminalSession.process.stdin.write(payload.data);
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
