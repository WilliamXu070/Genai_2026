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

const agenticCreateDraftButton = document.getElementById("agentic-create-draft");
const agenticConfirmRunButton = document.getElementById("agentic-confirm-run");
const agenticRedoButton = document.getElementById("agentic-redo");
const agenticForkButton = document.getElementById("agentic-fork");
const agenticUrlInput = document.getElementById("agentic-url");
const agenticObjectiveInput = document.getElementById("agentic-objective");
const agenticAdditionsInput = document.getElementById("agentic-additions");
const agenticProcedure = document.getElementById("agentic-procedure");
const agenticLog = document.getElementById("agentic-log");
const agenticIds = document.getElementById("agentic-ids");
const agenticVideo = document.getElementById("agentic-video");
const agenticRuns = document.getElementById("agentic-runs");

let sessionId;
let currentForestId;
let currentTreeId;

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

function appendAgenticLog(line) {
  if (!agenticLog) return;
  agenticLog.textContent += `\n${line}`;
  agenticLog.scrollTop = agenticLog.scrollHeight;
}

function renderAgenticRuns(runs) {
  if (!agenticRuns) return;
  agenticRuns.innerHTML = "";
  runs.slice(0, 10).forEach((run) => {
    const li = document.createElement("li");
    li.textContent = `${run.runId} · ${run.status} · ${run.summary}`;
    agenticRuns.appendChild(li);
  });
}

async function refreshAgenticRuns() {
  if (!window.agenticApi || !currentForestId) return;
  const runs = await window.agenticApi.listRuns(currentForestId);
  renderAgenticRuns(runs);
}

async function bootAgenticLoop() {
  if (!window.agenticApi) return;

  const forests = await window.agenticApi.listForests();
  if (forests.length > 0) {
    currentForestId = forests[0].forestId;
    const trees = await window.agenticApi.listTrees(currentForestId);
    currentTreeId = trees[0]?.treeId;
    if (agenticIds) {
      agenticIds.textContent = `forest: ${currentForestId} | tree: ${currentTreeId || "-"}`;
    }
    refreshAgenticRuns();
  }

  const off = window.agenticApi.onEvent((evt) => {
    if (evt.type === "agentic_status") {
      appendAgenticLog(evt.value);
    }
  });
  window.addEventListener("beforeunload", () => off?.());
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

agenticCreateDraftButton?.addEventListener("click", async () => {
  if (!window.agenticApi) return;
  appendAgenticLog("Testing flow officially begins.");

  const result = await window.agenticApi.createDraft({
    forestId: currentForestId,
    projectName: "Jungle",
    url: agenticUrlInput?.value || "http://127.0.0.1:3000",
    objective: agenticObjectiveInput?.value || "Convert task to Playwright procedure",
    notes: agenticAdditionsInput?.value || ""
  });

  currentForestId = result.forestId;
  currentTreeId = result.tree.treeId;
  if (agenticIds) {
    agenticIds.textContent = `forest: ${currentForestId} | tree: ${currentTreeId}`;
  }
  if (agenticProcedure) {
    agenticProcedure.textContent = JSON.stringify(result.tree.procedure, null, 2);
  }
  appendAgenticLog(result.tree.procedure.confirmMessage || "Confirm generated procedure before execution.");
  refreshAgenticRuns();
});

agenticConfirmRunButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !currentForestId || !currentTreeId) return;
  appendAgenticLog("Converting procedure into Request Parser and Playwright Executor with video...");

  const result = await window.agenticApi.confirmAndRun({
    forestId: currentForestId,
    treeId: currentTreeId,
    additions: agenticAdditionsInput?.value || "",
    url: agenticUrlInput?.value || "http://127.0.0.1:3000"
  });

  appendAgenticLog(`Run ${result.run.runId}: ${result.run.status}`);
  appendAgenticLog(result.run.summary);

  if (result.run.videoPath && agenticVideo) {
    agenticVideo.src = `file:///${result.run.videoPath.replace(/\\/g, "/")}`;
  }

  refreshAgenticRuns();
});

agenticRedoButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !currentForestId || !currentTreeId) return;
  appendAgenticLog("Redoing previous test with current tree procedure...");
  const result = await window.agenticApi.redoRun({
    forestId: currentForestId,
    treeId: currentTreeId,
    additions: agenticAdditionsInput?.value || "",
    url: agenticUrlInput?.value || "http://127.0.0.1:3000"
  });
  appendAgenticLog(`Redo complete: ${result.run.status}`);
  refreshAgenticRuns();
});

agenticForkButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !currentForestId || !currentTreeId) return;
  const fork = await window.agenticApi.forkTree({
    forestId: currentForestId,
    fromTreeId: currentTreeId,
    notes: agenticAdditionsInput?.value || "Forked variant"
  });
  currentTreeId = fork.treeId;
  if (agenticIds) {
    agenticIds.textContent = `forest: ${currentForestId} | tree: ${currentTreeId}`;
  }
  if (agenticProcedure) {
    agenticProcedure.textContent = JSON.stringify(fork.procedure, null, 2);
  }
  appendAgenticLog(`Forked new tree version v${fork.version}.`);
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
bootAgenticLoop();

function renderTimeline(events) {

  const container = document.getElementById("timeline-events")
  container.innerHTML = ""

  if (!events.length) return

  const min = new Date(events[0].timestamp).getTime()
  const max = new Date(events[events.length-1].timestamp).getTime()
  const span = max - min || 1

  events.forEach((event, i) => {

    const t = new Date(event.timestamp).getTime()
    const percent = ((t - min) / span) * 100

    const wrapper = document.createElement("div")
    wrapper.className = "timeline-event " + (i % 2 ? "up" : "down")
    wrapper.style.left = percent + "%"

    const branch = document.createElement("div")
    branch.className = "timeline-branch"

    const node = document.createElement("div")
    node.className = "timeline-card-node " + (event.status || "")

    const time = document.createElement("div")
    time.className = "timeline-time"
    time.textContent = new Date(event.timestamp).toLocaleTimeString()

    const text = document.createElement("div")
    text.textContent = event.summary

    node.appendChild(time)
    node.appendChild(text)

    wrapper.appendChild(branch)
    wrapper.appendChild(node)

    container.appendChild(wrapper)

  })
}

const sampleTimelineEvents = [
  {
    timestamp: "2026-03-14T10:00:00",
    status: "success",
    summary:
      "Run initialized. Jungle launched the runtime scenario and connected to the project environment. Initial instrumentation hooks were activated."
  },
  {
    timestamp: "2026-03-14T10:00:03",
    status: "success",
    summary:
      "The system navigated to the login page. All required assets were loaded and the DOM stabilized. Jungle prepared the credential submission step."
  },
  {
    timestamp: "2026-03-14T10:00:07",
    status: "running",
    summary:
      "Credential submission began. Form inputs were filled and validation handlers executed. The agent is currently waiting for authentication results."
  },
  {
    timestamp: "2026-03-14T10:00:12",
    status: "success",
    summary:
      "Dashboard navigation completed successfully. Page state stabilized and performance metrics were captured. The run continued to the next action."
  }
]

renderTimeline(sampleTimelineEvents)
