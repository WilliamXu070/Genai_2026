const artifactList = document.getElementById("artifact-list");
const refreshTestsButton = document.getElementById("refresh-tests");
const regenerateTestButton = document.getElementById("regenerate-test");
const runMeta = document.getElementById("run-meta");
const runVideo = document.getElementById("run-video");
const saveVersionButton = document.getElementById("save-version");
const searchInput = document.getElementById("search-input");
const sessionStatus = document.getElementById("session-status");
const terminalCloseButton = document.getElementById("terminal-close");
const terminalHost = document.getElementById("terminal-host");
const terminalMeta = document.getElementById("terminal-meta");
const terminalRestartButton = document.getElementById("terminal-restart");
const testId = document.getElementById("test-id");
const testList = document.getElementById("test-list");
const testNotes = document.getElementById("test-notes");
const testObjective = document.getElementById("test-objective");
const testStatus = document.getElementById("test-status");
const testTitle = document.getElementById("test-title");
const testUpdated = document.getElementById("test-updated");
const testVersion = document.getElementById("test-version");
const versionText = document.getElementById("version-text");
const versionList = document.getElementById("version-list");

let activeTestId = null;
let tests = [];
let activeTerminalSessionId = null;
let ptyTerminal = null;
let fitAddon = null;
let terminalOffData = null;
let terminalOffExit = null;
let codexSeedTimer = null;

function setStatus(value) {
  if (sessionStatus) {
    sessionStatus.textContent = value;
  }
}

function toLocalFileUrl(filePath) {
  if (!filePath) {
    return "";
  }
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function setTerminalMeta(value) {
  if (terminalMeta) {
    terminalMeta.textContent = value;
  }
}

function createTerminalUiIfNeeded() {
  if (ptyTerminal || !terminalHost || !window.Terminal || !window.FitAddon?.FitAddon) {
    return;
  }

  ptyTerminal = new window.Terminal({
    allowTransparency: true,
    convertEol: true,
    cursorBlink: true,
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 13,
    scrollback: 4000,
    theme: {
      background: "#05080d",
      cursor: "#7dd8ff",
      foreground: "#e6edf5"
    }
  });
  fitAddon = new window.FitAddon.FitAddon();
  ptyTerminal.loadAddon(fitAddon);
  ptyTerminal.open(terminalHost);
  fitAddon.fit();

  ptyTerminal.onData((chunk) => {
    if (!activeTerminalSessionId || !window.terminalApi) {
      return;
    }
    window.terminalApi.sendInput(activeTerminalSessionId, chunk);
  });

  ptyTerminal.onResize(({ cols, rows }) => {
    if (!activeTerminalSessionId || !window.terminalApi) {
      return;
    }
    window.terminalApi.resize(activeTerminalSessionId, cols, rows);
  });
}

function buildCodexSeedPrompt(version, run) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const artifactBlock = artifacts.length > 0 ? artifacts.map((item) => `- ${item}`).join("\n") : "- none";
  return [
    "Langflow test execution results:",
    `- objective: ${version?.objective || "-"}`,
    `- status: ${run?.status || "not_run"}`,
    `- summary: ${run?.summary || "-"}`,
    `- video_path: ${run?.videoPath || "-"}`,
    "- artifacts:",
    artifactBlock,
    "",
    "Prompt: Fix these issues."
  ].join("\n");
}

async function closeTerminalSession() {
  if (!window.terminalApi || !activeTerminalSessionId) {
    return;
  }
  await window.terminalApi.disposeSession(activeTerminalSessionId);
  activeTerminalSessionId = null;
  terminalOffData?.();
  terminalOffExit?.();
  terminalOffData = null;
  terminalOffExit = null;
  if (codexSeedTimer) {
    clearTimeout(codexSeedTimer);
    codexSeedTimer = null;
  }
  setTerminalMeta("Terminal closed.");
}

function sendTerminalCommand(command) {
  if (!activeTerminalSessionId || !window.terminalApi) {
    return;
  }
  window.terminalApi.sendInput(activeTerminalSessionId, `${command}\n`);
}

async function startCodexSessionForVersion(version) {
  createTerminalUiIfNeeded();
  if (!window.terminalApi || !ptyTerminal) {
    setTerminalMeta("Terminal API unavailable.");
    return;
  }

  if (activeTerminalSessionId) {
    await closeTerminalSession();
  }

  const session = await window.terminalApi.createSession({
    cols: ptyTerminal.cols || 120,
    rows: ptyTerminal.rows || 26
  });
  activeTerminalSessionId = session.sessionId;
  setTerminalMeta(`Session ${session.sessionId} - launching codex for v${version.number}`);

  terminalOffData = window.terminalApi.onData((payload) => {
    if (payload.sessionId === activeTerminalSessionId) {
      ptyTerminal.write(payload.data);
    }
  });

  terminalOffExit = window.terminalApi.onExit((payload) => {
    if (payload.sessionId === activeTerminalSessionId) {
      ptyTerminal.writeln("\r\n[Jungle] codex terminal session closed.");
      setTerminalMeta("Terminal offline.");
      activeTerminalSessionId = null;
    }
  });

  window.terminalApi.resize(activeTerminalSessionId, ptyTerminal.cols, ptyTerminal.rows);
  ptyTerminal.focus();

  const test = tests.find((item) => item.id === activeTestId);
  const detail = test?.id && window.catalogApi ? await window.catalogApi.getTest(test.id) : null;
  const run = detail?.runs?.[0] || null;
  const seedPrompt = buildCodexSeedPrompt(version, run);
  sendTerminalCommand("clear");
  sendTerminalCommand(
    `echo \"Jungle context: test=${test?.id || "-"} version=v${version.number} status=${version.status}\"`
  );
  sendTerminalCommand(`echo \"Objective: ${(version.objective || "").replace(/"/g, "'")}\"`);
  sendTerminalCommand("codex");
  codexSeedTimer = setTimeout(() => {
    if (activeTerminalSessionId && window.terminalApi) {
      window.terminalApi.sendInput(activeTerminalSessionId, `${seedPrompt}\n`);
      setTerminalMeta(`Session ${session.sessionId} seeded with v${version.number} test results.`);
    }
    codexSeedTimer = null;
  }, 1300);
}

function renderArtifacts(run) {
  if (!artifactList) {
    return;
  }

  artifactList.innerHTML = "";
  if (!run || !Array.isArray(run.artifacts) || run.artifacts.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No artifacts available.";
    artifactList.appendChild(li);
    return;
  }

  run.artifacts.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    artifactList.appendChild(li);
  });
}

function renderRuns(test) {
  const run = test?.runs?.[0] || null;
  if (runMeta) {
    runMeta.textContent = run
      ? `${run.status.toUpperCase()} - ${run.summary || "No summary"}`
      : "No run selected.";
  }
  if (runVideo) {
    runVideo.src = run?.videoPath ? toLocalFileUrl(run.videoPath) : "";
  }
  renderArtifacts(run);
}

function renderVersions(test) {
  if (!versionList) {
    return;
  }

  versionList.innerHTML = "";
  const versions = [...(test?.versions || [])].sort((a, b) => b.number - a.number);
  versions.forEach((version) => {
    const li = document.createElement("li");
    li.className = "version-item";
    li.innerHTML = `
      <div>
        <strong>v${version.number}</strong>
        <div class="meta">${version.status} - ${version.createdAt}</div>
      </div>
      <button type="button">Run This Version</button>
    `;
    const button = li.querySelector("button");
    button?.addEventListener("click", async () => {
      await startCodexSessionForVersion(version);
    });
    versionList.appendChild(li);
  });
}

function setActiveTest(test) {
  if (!test) {
    return;
  }
  activeTestId = test.id;
  if (testTitle) testTitle.textContent = test.title;
  if (testStatus) testStatus.textContent = test.status;
  if (testId) testId.textContent = test.id;
  if (testVersion) testVersion.textContent = String(test.latestVersion || "-");
  if (testUpdated) testUpdated.textContent = test.updatedAt || "-";
  if (testObjective) testObjective.value = test.objective || "";
  if (testNotes) testNotes.value = "";
  renderVersions(test);
  renderRuns(test);
}

async function openTest(id) {
  if (!window.catalogApi) {
    return;
  }
  const detail = await window.catalogApi.getTest(id);
  setActiveTest(detail);
}

function renderList() {
  if (!testList) {
    return;
  }

  const term = (searchInput?.value || "").trim().toLowerCase();
  const filtered = tests.filter((item) => {
    if (!term) {
      return true;
    }
    return (
      item.title.toLowerCase().includes(term) ||
      item.objective.toLowerCase().includes(term) ||
      item.status.toLowerCase().includes(term)
    );
  });

  testList.innerHTML = "";
  filtered.forEach((item) => {
    const li = document.createElement("li");
    li.className = "test-item";
    li.innerHTML = `
      <button type="button" data-id="${item.id}">
        <strong>${item.title}</strong>
        <span>${item.status} - v${item.latestVersion}</span>
      </button>
    `;
    const button = li.querySelector("button");
    button?.addEventListener("click", () => {
      openTest(item.id);
    });
    testList.appendChild(li);
  });
}

async function loadCatalog() {
  if (!window.catalogApi) {
    setStatus("Catalog bridge missing");
    return;
  }

  setStatus("Loading");
  tests = await window.catalogApi.listTests();
  renderList();
  if (tests.length > 0) {
    await openTest(tests[0].id);
  }
  setStatus("Catalog ready");
}

saveVersionButton?.addEventListener("click", async () => {
  if (!window.catalogApi || !activeTestId) {
    return;
  }
  await window.catalogApi.updateTest({
    testId: activeTestId,
    objective: testObjective?.value || "",
    notes: testNotes?.value || "",
    status: "pending_approval"
  });
  await loadCatalog();
});

regenerateTestButton?.addEventListener("click", async () => {
  if (!window.catalogApi || !activeTestId) {
    return;
  }
  await window.catalogApi.regenerateTest({
    testId: activeTestId,
    instruction: testNotes?.value || "Regenerated from UI controls."
  });
  await loadCatalog();
});

refreshTestsButton?.addEventListener("click", async () => {
  await loadCatalog();
});

terminalRestartButton?.addEventListener("click", async () => {
  const detail = activeTestId && window.catalogApi ? await window.catalogApi.getTest(activeTestId) : null;
  const latest = detail?.versions?.[detail.versions.length - 1];
  if (!latest) {
    setTerminalMeta("Select a test first.");
    return;
  }
  await startCodexSessionForVersion(latest);
});

terminalCloseButton?.addEventListener("click", async () => {
  await closeTerminalSession();
});

searchInput?.addEventListener("input", () => {
  renderList();
});

if (versionText && window.appInfo) {
  versionText.textContent = `${window.appInfo.name} v${window.appInfo.version}`;
}
setStatus("Connecting");
loadCatalog();
