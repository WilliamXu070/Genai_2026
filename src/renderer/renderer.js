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
