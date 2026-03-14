const cwdLabel = document.getElementById("cwd-label");
const menuPanel = document.getElementById("menu-panel");
const menuToggle = document.getElementById("menu-toggle");
const sessionStatus = document.getElementById("session-status");
const terminalHost = document.getElementById("terminal-host");
const versionText = document.getElementById("version-text");

let fitAddon;
let ptyTerminal;
let resizeTimer;
let sessionId;

function setStatus(value) {
  if (sessionStatus) {
    sessionStatus.textContent = value;
  }
}

function toggleMenu() {
  if (!menuPanel || !menuToggle) {
    return;
  }

  const nextHidden = !menuPanel.hidden;
  menuPanel.hidden = nextHidden;
  menuToggle.setAttribute("aria-expanded", nextHidden ? "false" : "true");
}

function closeMenuOnOutsideClick(event) {
  if (!menuPanel || menuPanel.hidden) {
    return;
  }

  const target = event.target;
  if (menuPanel.contains(target) || menuToggle?.contains(target)) {
    return;
  }

  menuPanel.hidden = true;
  menuToggle?.setAttribute("aria-expanded", "false");
}

function syncPtySize() {
  if (!fitAddon || !ptyTerminal || !window.terminalApi || !sessionId) {
    return;
  }

  fitAddon.fit();
  window.terminalApi.resize(sessionId, ptyTerminal.cols, ptyTerminal.rows);
}

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(syncPtySize, 80);
}

function createXterm() {
  if (!window.Terminal || !window.FitAddon?.FitAddon || !terminalHost) {
    setStatus("Terminal UI failed");
    return;
  }

  ptyTerminal = new window.Terminal({
    allowTransparency: true,
    convertEol: true,
    cursorBlink: true,
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 14,
    scrollback: 5000,
    theme: {
      background: "#07130b",
      cursor: "#d2f9a5",
      foreground: "#eaf5e4"
    }
  });

  fitAddon = new window.FitAddon.FitAddon();
  ptyTerminal.loadAddon(fitAddon);
  ptyTerminal.open(terminalHost);
  fitAddon.fit();

  ptyTerminal.onData((data) => {
    if (!sessionId || !window.terminalApi) {
      return;
    }
    window.terminalApi.sendInput(sessionId, data);
  });

  ptyTerminal.onResize(({ cols, rows }) => {
    if (!sessionId || !window.terminalApi) {
      return;
    }
    window.terminalApi.resize(sessionId, cols, rows);
  });

  terminalHost.addEventListener("click", () => ptyTerminal.focus());
  window.addEventListener("resize", scheduleResize);
  window.addEventListener("beforeunload", () => clearTimeout(resizeTimer));

  if (versionText && window.appInfo) {
    versionText.textContent = `${window.appInfo.name} v${window.appInfo.version}`;
  }

  ptyTerminal.focus();
  // Exposed only for local UI tests that assert PTY output behavior.
  window.__jungleTerminal = ptyTerminal;
}

async function bootTerminal() {
  if (!window.terminalApi || !ptyTerminal) {
    setStatus("Bridge missing");
    return;
  }

  const offData = window.terminalApi.onData((payload) => {
    if (!sessionId || payload.sessionId !== sessionId) {
      return;
    }

    ptyTerminal.write(payload.data);
  });

  const offExit = window.terminalApi.onExit((payload) => {
    if (payload.sessionId !== sessionId) {
      return;
    }

    ptyTerminal.writeln("\r\n[Jungle] terminal session closed.");
    setStatus("Offline");
  });

  window.addEventListener("beforeunload", () => {
    offData?.();
    offExit?.();
  });

  try {
    const session = await window.terminalApi.createSession({
      cols: ptyTerminal.cols,
      rows: ptyTerminal.rows
    });
    sessionId = session.sessionId;

    if (cwdLabel) {
      cwdLabel.textContent = session.cwd;
    }

    setStatus("Connected");
    syncPtySize();
    ptyTerminal.focus();
  } catch (error) {
    setStatus("Startup failed");
    ptyTerminal.writeln(`\r\n[Jungle] ${error.message}`);
  }
}

menuToggle?.addEventListener("click", () => {
  toggleMenu();
});

document.addEventListener("click", (event) => {
  closeMenuOnOutsideClick(event);
});

setStatus("Connecting");
createXterm();
bootTerminal();
