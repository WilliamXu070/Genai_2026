const path = require('node:path');
const fs = require('node:fs');
const { chromium, expect } = require('playwright');

async function run({ baseUrl, artifactsDir }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const stateStore = {};
  try {
  await page.goto("http://127.0.0.1:3095", { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await expect(page.locator("text=Atlas Airfolio").first()).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("text=Launch Runway").first()).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("text=Cabin Systems").first()).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("text=Landing Brief").first()).toBeVisible();
  await page.waitForTimeout(1000);
  await page.evaluate(async () => { const maxY = document.documentElement.scrollHeight - window.innerHeight; let y = 0; const stride = Math.max(120, Math.floor(window.innerHeight * 0.75)); while (y < maxY) { y = Math.min(maxY, y + stride); window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } });
  await page.waitForTimeout(1000);
  await expect(page.locator("text=Open the hangar").first()).toBeVisible();
  await page.waitForTimeout(1000);
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run };
