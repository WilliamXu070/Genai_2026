const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron, expect } = require('playwright');

async function run({ projectRoot, artifactsDir }) {
  const app = await electron.launch({ args: [projectRoot], cwd: projectRoot });
  const page = await app.firstWindow();
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
  await expect(page.locator("#project-count").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("#approval-count").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("#progress-count").first()).toBeVisible();
  await page.waitForTimeout(500);
  } finally {
    await page.screenshot({ path: path.join(artifactsDir, 'final_' + Date.now() + '.png'), fullPage: true }).catch(() => {});
    await app.close();
  }
}

module.exports = { run };
