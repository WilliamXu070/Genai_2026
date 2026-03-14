const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

function parseDotEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const out = {};

  if (!fs.existsSync(envPath)) {
    return out;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, "");
    out[key] = value;
  }

  return out;
}

function extractJson(text) {
  const block = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = block ? block[1] : text;
  return JSON.parse(candidate.trim());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildExampleSite(siteDir) {
  ensureDir(siteDir);

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jungle Example Builder</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; background: #0e1711; color: #e9f4e5; }
      .panel { border: 1px solid #2b3d30; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
      button { background: #b7f279; color: #10210f; border: 0; padding: 10px 14px; border-radius: 8px; }
      .badge { display: inline-block; margin-left: 8px; padding: 4px 8px; border-radius: 8px; background: #1f2e25; }
    </style>
  </head>
  <body>
    <h1 id="app-title">Jungle Operational Example</h1>
    <div class="panel" id="scenario-panel">
      <h2>Scenario</h2>
      <p id="scenario-description">Hardcoded website builder scenario for MVP runtime validation.</p>
      <button id="execute-btn">Execute test</button><span class="badge" id="run-state">idle</span>
    </div>

    <div class="panel" id="result-panel">
      <h2>Result</h2>
      <p id="result-summary">Pending execution</p>
    </div>

    <script>
      const state = {
        mission: "Validate Jungle runtime semantics",
        currentStep: "idle",
        steps: ["build", "render", "verify", "report"],
        status: "idle"
      };

      const stateEl = document.getElementById("run-state");
      const summaryEl = document.getElementById("result-summary");
      document.getElementById("execute-btn").addEventListener("click", () => {
        state.currentStep = "verify";
        state.status = "pass";
        stateEl.textContent = state.status;
        summaryEl.textContent = "UI render and state parsing simulation successful.";
      });
    </script>
  </body>
</html>`;

  fs.writeFileSync(path.join(siteDir, "index.html"), html, "utf8");
}

function startStaticServer(siteDir) {
  const server = http.createServer((req, res) => {
    const reqPath = req.url === "/" ? "/index.html" : req.url;
    const fullPath = path.join(siteDir, reqPath);

    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(fullPath, "utf8"));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

function parseStateFromHtml(html) {
  return {
    hasAppTitle: html.includes('id="app-title"'),
    hasScenarioPanel: html.includes('id="scenario-panel"'),
    hasResultPanel: html.includes('id="result-panel"'),
    hasExecuteButton: html.includes('id="execute-btn"'),
    hasRunState: html.includes('id="run-state"')
  };
}

async function runGeminiSemanticCheck(apiKey, html) {
  if (!apiKey) {
    return {
      pass: false,
      reason: "GEMINI_API_KEY missing",
      status: "skipped"
    };
  }

  const prompt = `You are validating a prototype UI. Analyze this HTML and return strict JSON with keys: pass(boolean), reason(string), cues(array of strings).\n\nExpected cues: app title, scenario panel, result panel, execute button, run state badge.\n\nHTML:\n${html}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    return {
      pass: false,
      reason: `Gemini API error: ${response.status}`,
      raw: err,
      status: "error"
    };
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

  try {
    const parsed = extractJson(text);
    return { ...parsed, status: "ok" };
  } catch (_) {
    return {
      pass: false,
      reason: "Failed to parse Gemini JSON",
      raw: text,
      status: "error"
    };
  }
}

async function runOperationalExample(projectRoot) {
  const env = { ...parseDotEnv(projectRoot), ...process.env };
  const apiKey = env.GEMINI_API_KEY;

  const siteDir = path.join(projectRoot, "db", "operational_example_site");
  ensureDir(path.join(projectRoot, "db", "runs"));
  buildExampleSite(siteDir);

  const { server, port } = await startStaticServer(siteDir);
  const url = `http://127.0.0.1:${port}`;

  let html = "";
  try {
    const res = await fetch(url);
    html = await res.text();
  } finally {
    server.close();
  }

  const parsedState = parseStateFromHtml(html);
  const semantic = await runGeminiSemanticCheck(apiKey, html);

  const report = {
    generatedAt: new Date().toISOString(),
    scenario: "Hardcoded website builder + semantic validation",
    url,
    parsedState,
    semantic,
    overallPass:
      Object.values(parsedState).every(Boolean) && semantic.pass === true && semantic.status === "ok"
  };

  const outPath = path.join(projectRoot, "db", "runs", `operational_example_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  return { outPath, report };
}

if (require.main === module) {
  runOperationalExample(process.cwd())
    .then(({ outPath, report }) => {
      console.log("Operational example completed.");
      console.log(`Report: ${outPath}`);
      console.log(`overallPass: ${report.overallPass}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  runOperationalExample
};
