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
  await page.locator("#themeToggle").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("body.light").first()).toBeHidden();
  await page.waitForTimeout(500);
  await page.locator("text=Frontend").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#skillsGrid").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Backend").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("text=DevOps").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("text=All").first().click();
  await page.waitForTimeout(500);
  await page.locator("text=Send Message").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#nameError").first()).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.locator("#emailError").first()).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.locator("#messageError").first()).toBeHidden();
  await page.waitForTimeout(500);
  await page.locator("text=About").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#about").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("text=Skills").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#skills").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("text=Projects").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#projects").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("text=Experience").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#experience").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator("text=Contact").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("#contact").first()).toBeVisible();
  await page.waitForTimeout(500);
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run };
