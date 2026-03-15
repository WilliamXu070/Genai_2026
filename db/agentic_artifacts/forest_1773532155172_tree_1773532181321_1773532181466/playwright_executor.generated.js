const path = require('node:path');
const fs = require('node:fs');
const { chromium, expect } = require('playwright');

async function run({ baseUrl, artifactsDir }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const stateStore = {};
  try {
  await page.goto("http://127.0.0.1:3095/", { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await expect(page.locator("text=Atlas Airfolio").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.waitForTimeout(10000);
  await page.waitForTimeout(400);
  await page.evaluate(async () => { const maxY = document.documentElement.scrollHeight - window.innerHeight; let y = 0; const stride = Math.max(64, Math.floor(window.innerHeight * 0.35)); while (y < maxY) { y = Math.min(maxY, y + stride); window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 450)); } });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773532181466.png'), fullPage: true });
  await page.waitForTimeout(500);
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run };
