const path = require('node:path');
const fs = require('node:fs');
const { chromium, expect } = require('playwright');

async function run({ baseUrl, artifactsDir }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const stateStore = {};
  try {
  await page.goto("http://127.0.0.1:8088/", { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await expect(page.locator("text=Ball Physics Inside Rotating Square").first()).toBeVisible();
  await page.waitForTimeout(3000);
  stateStore["beforeState"] = await page.locator("#title").first().innerText();
  await page.waitForTimeout(3000);
  await page.locator("text=Submit").first().click();
  await page.waitForTimeout(3000);
  await page.waitForFunction(({ sel, prev }) => { const el = document.querySelector(sel); return !!el && (el.innerText || el.textContent || '').trim() !== prev; }, { sel: "#title", prev: (stateStore["beforeState"] || '') }, { timeout: 5000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773502241494.png'), fullPage: true });
  await page.waitForTimeout(3000);
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run };
