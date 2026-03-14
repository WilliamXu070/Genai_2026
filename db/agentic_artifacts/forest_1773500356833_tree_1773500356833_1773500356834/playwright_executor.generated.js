const path = require('node:path');
const fs = require('node:fs');
const { chromium, expect } = require('playwright');

async function run({ baseUrl, artifactsDir }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const stateStore = {};
  try {
  // TODO unsupported action: Assert visibility of the title
  // TODO unsupported action: Click the 'Run animation' button
  // TODO unsupported action: Wait for the status text to change to 'Completed'
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { run };
