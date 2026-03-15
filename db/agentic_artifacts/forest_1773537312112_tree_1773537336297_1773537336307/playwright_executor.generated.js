const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron, expect } = require('playwright');

async function run({ projectRoot, artifactsDir }) {
  const app = await electron.launch({ args: [projectRoot], cwd: projectRoot });
  const page = await app.firstWindow();
  const stateStore = {};
  try {
    await page.waitForLoadState('domcontentloaded');
  await expect(page.locator("role=heading[name='Jungle Approval Queue']").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("#refresh-projects").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Jungle\\nUpdated 3/15/2026, 1:15:30 AM").first()).toBeVisible();
  await page.waitForTimeout(500);
  } finally {
    await page.screenshot({ path: path.join(artifactsDir, 'final_' + Date.now() + '.png'), fullPage: true }).catch(() => {});
    await app.close();
  }
}

module.exports = { run };
