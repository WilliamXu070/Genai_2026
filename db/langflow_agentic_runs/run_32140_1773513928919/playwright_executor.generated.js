const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const baseUrl = "http://127.0.0.1:8088";
  const artifactsDir = "C:\\Users\\William\\Desktop\\Projects\\Genai_2026\\db\\langflow_agentic_runs\\run_32140_1773513928919";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const stateStore = {};
  const stepResults = [];
  let status = 'pass';
  let summary = 'Procedure executed successfully.';
  try {
  await page.goto("http://127.0.0.1:8088", { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(10000);
  await page.locator("#session-status").first().waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: path.join(artifactsDir, `step_${Date.now()}.png`), fullPage: true });
  await page.locator("#terminal-input").first().fill("node Testing/cli_agentic_loop/run_cli_loop.js", { timeout: 10000 });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(artifactsDir, `step_${Date.now()}.png`), fullPage: true });
  } catch (error) {
    status = 'fail';
    summary = error.message;
  }
  await page.screenshot({ path: path.join(artifactsDir, `final_${Date.now()}.png`), fullPage: true });
  await context.close();
  await browser.close();
  const artifacts = fs.readdirSync(artifactsDir).map((n) => path.join(artifactsDir, n));
  const video = artifacts.find((a) => a.endsWith('.webm')) || null;
  const out = { status, summary, steps: stepResults, video_path: video, artifacts };
  console.log(JSON.stringify(out));
})().catch((error) => { console.error(error); process.exit(1); });
