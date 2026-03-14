const assert = require("node:assert");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function run() {
  const projectRoot = path.resolve(__dirname, "..");
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const app = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot
    });

    try {
      const page = await app.firstWindow();
      await page.waitForSelector("#session-status", { timeout: 15000 });

      const hasTerminalApi = await page.evaluate(() => typeof window.terminalApi === "object");
      assert.equal(hasTerminalApi, true, "Expected preload to expose window.terminalApi");

      await page.waitForFunction(
        () => document.getElementById("session-status")?.textContent?.trim().toLowerCase() === "connected",
        null,
        { timeout: 20000 }
      );

      await page.click("#terminal-host");
      const marker = `JUNGLE_PTY_OK_${Date.now()}`;
      await page.keyboard.type(`echo ${marker}`);
      await page.keyboard.press("Enter");

      await page.waitForFunction(
        (m) => {
          if (!window.__jungleTerminal) {
            return false;
          }
          const text = (function readTerminalText(terminal) {
            const buffer = terminal?.buffer?.active;
            if (!buffer) {
              return "";
            }
            const start = Math.max(0, buffer.baseY - 300);
            const end = buffer.baseY + buffer.cursorY;
            const lines = [];
            for (let i = start; i <= end; i += 1) {
              const line = buffer.getLine(i);
              if (line) {
                lines.push(line.translateToString(true));
              }
            }
            return lines.join("\n");
          })(window.__jungleTerminal);
          return text.includes(m);
        },
        marker,
        { timeout: 15000 }
      );

      const statusText = (await page.locator("#session-status").innerText()).trim().toLowerCase();
      assert.equal(statusText, "connected", "Terminal should remain connected");
      await app.close();
      return;
    } catch (error) {
      lastError = error;
      await app.close();
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError;
}

run()
  .then(() => {
    console.log("ui_terminal_bridge.test.js passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
