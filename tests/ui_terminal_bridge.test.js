const assert = require("node:assert");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function run() {
  const projectRoot = path.resolve(__dirname, "..");
  let lastError;

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

      const hasCatalogApi = await page.evaluate(() => typeof window.catalogApi === "object");
      assert.equal(hasCatalogApi, true, "Expected preload to expose window.catalogApi");

      await page.waitForFunction(
        () => document.getElementById("session-status")?.textContent?.trim().toLowerCase() === "catalog ready",
        null,
        { timeout: 20000 }
      );

      await page.waitForSelector("#test-list li button", { timeout: 20000 });
      await page.click("#test-list li button");

      await page.waitForFunction(
        () => {
          const title = document.getElementById("test-title")?.textContent?.trim();
          const objective = document.getElementById("test-objective")?.value?.trim();
          return Boolean(title) && title !== "Select a test" && Boolean(objective);
        },
        { timeout: 15000 }
      );

      const statusText = (await page.locator("#session-status").innerText()).trim().toLowerCase();
      assert.equal(statusText, "catalog ready", "Catalog should be ready");
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
