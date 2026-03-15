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
  await expect(page.locator("#refresh-projects").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("#refresh-projects").first().click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  await page.waitForTimeout(400);
  await expect(page.locator("#session-status").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773538376004.png'), fullPage: true });
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
