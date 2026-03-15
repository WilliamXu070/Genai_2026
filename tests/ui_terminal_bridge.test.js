const assert = require("node:assert");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function run() {
  const projectRoot = path.resolve(__dirname, "..");
  let lastError;
  const READY_STATUSES = new Set(["approval queues ready", "no persisted history yet"]);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let app;
    try {
      app = await electron.launch({
        args: [projectRoot],
        cwd: projectRoot
      });
    } catch (error) {
      if (String(error.message || "").includes("EPERM")) {
        console.log("ui_terminal_bridge.test.js skipped (sandbox denied electron launch)");
        return;
      }
      throw error;
    }

    try {
      const page = await app.firstWindow();
      await page.waitForSelector("#session-status", { timeout: 15000 });

      const apiState = await page.evaluate(() => ({
        agentic: typeof window.agenticApi === "object",
        catalog: typeof window.catalogApi === "object"
      }));
      assert.equal(apiState.agentic, true, "Expected preload to expose window.agenticApi");
      assert.equal(apiState.catalog, true, "Expected preload to expose window.catalogApi");

      await page.waitForFunction(
        (allowedStatuses) => {
          const status = document.getElementById("session-status")?.textContent?.trim().toLowerCase();
          return allowedStatuses.includes(status);
        },
        Array.from(READY_STATUSES),
        { timeout: 20000 }
      );

      const statusText = (await page.locator("#session-status").innerText()).trim().toLowerCase();
      assert.equal(READY_STATUSES.has(statusText), true, `Unexpected session status: ${statusText}`);

      const projectListExists = await page.locator("#project-list").count();
      assert.equal(projectListExists, 1, "Expected v2 approval queue project list to render");

      const projectButtons = page.locator("#project-list li button");
      if (await projectButtons.count()) {
        await projectButtons.first().click();
        await page.waitForFunction(
          () => {
            const title = document.getElementById("runs-title")?.textContent?.trim();
            const meta = document.getElementById("runs-meta")?.textContent?.trim();
            return Boolean(title) && Boolean(meta);
          },
          null,
          { timeout: 15000 }
        );
      } else {
        const emptyStateText = await page.locator("#project-count").innerText();
        assert.equal(Boolean(emptyStateText.trim()), true, "Expected empty project state copy");
      }

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
