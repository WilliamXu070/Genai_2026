const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron, expect } = require('playwright');

async function run({ projectRoot, artifactsDir }) {
  const app = await electron.launch({ args: [projectRoot], cwd: projectRoot, recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await app.firstWindow();
  const pageVideo = typeof page.video === 'function' ? page.video() : null;
  const stateStore = {};
  try {
    await page.waitForLoadState('domcontentloaded');
  await expect(page.locator("text=Jungle Approval Queue").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Persisted Projects").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Approval-Gated Runs").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=To Be Approved").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Currently In Progress").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Project Run History").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("#refresh-projects").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#create-variant-run").first()).toBeVisible();
  await page.waitForTimeout(500);
  } finally {
    await page.screenshot({ path: path.join(artifactsDir, 'final_' + Date.now() + '.png'), fullPage: true }).catch(() => {});
    await app.close();
    if (pageVideo) {
      try {
        await pageVideo.path();
      } catch (_) {}
    }
  }
}

module.exports = { run };
