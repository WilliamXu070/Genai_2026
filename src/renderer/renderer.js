const cwdLabel = document.getElementById("cwd-label");
const focusTerminalButton = document.getElementById("focus-terminal");
const launchCodexButton = document.getElementById("launch-codex");
const projectRootLabel = document.getElementById("project-root");
const quickCommandButtons = document.querySelectorAll("[data-command]");
const sessionStatus = document.getElementById("session-status");
const shellPathLabel = document.getElementById("shell-path");
const terminalForm = document.getElementById("terminal-form");
const terminalInput = document.getElementById("terminal-input");
const terminalOutput = document.getElementById("terminal-output");
const versionText = document.getElementById("version-text");

const runMvpButton = document.getElementById("run-mvp");
const runOperationalExampleButton = document.getElementById("run-operational-example");
const runLiveStatus = document.getElementById("run-live-status");
const runLiveSteps = document.getElementById("run-live-steps");
const runHistory = document.getElementById("run-history");
const todoBlueprint = document.getElementById("todo-blueprint");

let sessionId;

function stripAnsi(value) {
  return value.replace(
    // Matches the most common ANSI escape sequences so shell output stays legible.
    // eslint-disable-next-line no-control-regex
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g,
    ""
  );
}

function appendOutput(value) {
  if (!terminalOutput) {
    return;
  }

  terminalOutput.textContent += stripAnsi(value);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function sendCommand(command, options = {}) {
  if (!sessionId || !window.terminalApi || !command) {
    return;
  }

  if (!options.silentEcho) {
    appendOutput(`\n$ ${command}\n`);
  }

  window.terminalApi.sendInput(sessionId, `${command}\n`);
}

function focusTerminal() {
  terminalInput?.focus();
}

function renderRunHistory(runs) {
  if (!runHistory) {
    return;
  }

  runHistory.innerHTML = "";
  runs.forEach((run) => {
    const li = document.createElement("li");
    li.textContent = `${run.runId} · ${run.status} · ${run.scenarioName}`;
    runHistory.appendChild(li);
  });

  if (runs.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No runs yet.";
    runHistory.appendChild(li);
  }
}

async function refreshRuns() {
  if (!window.jungleApi) {
    return;
  }

  const runs = await window.jungleApi.listRuns();
  renderRunHistory(runs);
}

function renderTodoBlueprint(blueprint) {
  if (!todoBlueprint) {
    return;
  }

  todoBlueprint.innerHTML = "";

  blueprint.blankBoxes.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    todoBlueprint.appendChild(li);
  });

  if (blueprint.blankBoxes.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No blank boxes listed.";
    todoBlueprint.appendChild(li);
  }
}

async function bootJungleMvp() {
  if (!window.jungleApi) {
    return;
  }

  const off = window.jungleApi.onRunEvent((evt) => {
    if (!runLiveStatus || !runLiveSteps) {
      return;
    }

    if (evt.type === "status") {
      runLiveStatus.textContent = evt.value;
    }

    if (evt.type === "step") {
      runLiveSteps.textContent += `\n[step ${evt.index + 1}/${evt.total}] ${evt.step.action} ${evt.step.target || ""}`;
      runLiveSteps.scrollTop = runLiveSteps.scrollHeight;
    }

    if (evt.type === "run_finished") {
      runLiveStatus.textContent = `finished: ${evt.run.status}`;
      refreshRuns();
    }
  });

  window.addEventListener("beforeunload", () => {
    off?.();
  });

  const blueprint = await window.jungleApi.getTodoBlueprint();
  renderTodoBlueprint(blueprint);
  refreshRuns();
}

async function bootTerminal() {
  if (!window.terminalApi) {
    if (sessionStatus) {
      sessionStatus.textContent = "Terminal bridge missing";
    }

    appendOutput("[Jungle] Terminal bridge unavailable.\n");
    return;
  }

  const removeDataListener = window.terminalApi.onData((payload) => {
    if (!sessionId || payload.sessionId === sessionId) {
      appendOutput(payload.data);
    }
  });

  const removeExitListener = window.terminalApi.onExit((payload) => {
    if (payload.sessionId === sessionId) {
      appendOutput("\n[Jungle] Terminal session closed.\n");

      if (sessionStatus) {
        sessionStatus.textContent = "Terminal offline";
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    removeDataListener?.();
    removeExitListener?.();
  });

  try {
    const session = await window.terminalApi.createSession();
    sessionId = session.sessionId;

    if (projectRootLabel) {
      projectRootLabel.textContent = session.cwd;
    }

    if (cwdLabel) {
      cwdLabel.textContent = session.cwd;
    }

    if (shellPathLabel) {
      shellPathLabel.textContent = session.shellPath;
    }

    if (sessionStatus) {
      sessionStatus.textContent = "Terminal live";
    }

    if (versionText && window.appInfo) {
      versionText.textContent = `${window.appInfo.name} v${window.appInfo.version}`;
    }

    if (terminalInput) {
      terminalInput.disabled = false;
      terminalInput.placeholder = "Type a command and press Enter";
      focusTerminal();
    }
  } catch (error) {
    appendOutput(`[Jungle] ${error.message}\n`);

    if (sessionStatus) {
      sessionStatus.textContent = "Startup failed";
    }

    if (terminalInput) {
      terminalInput.disabled = true;
      terminalInput.placeholder = "Terminal failed to start";
    }
  }
}

focusTerminalButton?.addEventListener("click", () => {
  focusTerminal();
});

launchCodexButton?.addEventListener("click", () => {
  focusTerminal();
  sendCommand("codex");
});

runMvpButton?.addEventListener("click", async () => {
  if (!window.jungleApi) {
    return;
  }

  runLiveStatus.textContent = "starting";
  runLiveSteps.textContent = "Starting Jungle MVP run...";

  await window.jungleApi.startRun({
    command: "",
    cwd: projectRootLabel?.textContent || undefined,
    projectName: "Jungle",
    scenarioName: "Smoke test scenario",
    steps: [
      { action: "goto", target: "/" },
      { action: "assert", target: "landing loaded" },
      { action: "assert", target: "terminal connected" }
    ],
    url: "http://127.0.0.1:3000"
  });
});

runOperationalExampleButton?.addEventListener("click", async () => {
  if (!window.jungleApi) {
    return;
  }

  runLiveStatus.textContent = "operational_example_running";
  runLiveSteps.textContent = "Running hardcoded website builder + Gemini semantic validation...";

  try {
    const result = await window.jungleApi.runOperationalExample();
    runLiveStatus.textContent = result.report.overallPass
      ? "operational_example_pass"
      : "operational_example_fail";
    runLiveSteps.textContent += `\nReport: ${result.outPath}`;
    runLiveSteps.textContent += `\nSemantic status: ${result.report.semantic.status}`;
    runLiveSteps.textContent += `\nSemantic reason: ${result.report.semantic.reason || "ok"}`;
  } catch (error) {
    runLiveStatus.textContent = "operational_example_error";
    runLiveSteps.textContent += `\nError: ${error.message}`;
  }
});

quickCommandButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.getAttribute("data-command");

    if (command) {
      focusTerminal();
      sendCommand(command);
    }
  });
});

terminalForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!terminalInput) {
    return;
  }

  const command = terminalInput.value.trim();

  if (!command) {
    return;
  }

  sendCommand(command);
  terminalInput.value = "";
});

if (versionText && window.appInfo) {
  versionText.textContent = `${window.appInfo.name} v${window.appInfo.version}`;
}

appendOutput("Connecting to Jungle shell...\n");

if (terminalInput) {
  terminalInput.disabled = true;
}

bootTerminal();
bootJungleMvp();
