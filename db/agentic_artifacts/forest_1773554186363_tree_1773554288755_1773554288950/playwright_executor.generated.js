const path = require('node:path');
const fs = require('node:fs');
const { chromium, expect } = require('playwright');

async function run({ baseUrl, artifactsDir }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const stateStore = {};
  try {
  await page.goto("http://127.0.0.1:5173/", { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773554288950.png'), fullPage: true });
  await page.waitForTimeout(500);
  await page.locator("#scene").first().click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(1000);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773554288950.png'), fullPage: true });
  await page.waitForTimeout(500);
  await page.locator("#scene").first().click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(1000);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactsDir, 'step_1773554288950.png'), fullPage: true });
  await page.waitForTimeout(500);
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run };
