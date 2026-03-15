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
  stateStore["beforeState"] = await page.locator("#session-status").first().innerText();
  await page.waitForTimeout(500);
  await page.locator("#refresh-projects").first().click();
  await page.waitForTimeout(500);
  await page.waitForFunction(({ sel, prev }) => { const el = document.querySelector(sel); return !!el && (el.innerText || el.textContent || '').trim() !== prev; }, { sel: "#session-status", prev: (stateStore["beforeState"] || '') }, { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773537361103.png'), fullPage: true });
  await page.waitForTimeout(500);
  } finally {
    await page.screenshot({ path: path.join(artifactsDir, 'final_' + Date.now() + '.png'), fullPage: true }).catch(() => {});
    await app.close();
  }
}

module.exports = { run };
