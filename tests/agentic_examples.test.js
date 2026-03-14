const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { AgenticLoopManager } = require("../src/runtime/agentic_loop");

function mkSite(root, name, html) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
  return dir;
}

async function startServer(siteDir) {
  const server = http.createServer((req, res) => {
    const p = req.url === "/" ? "/index.html" : req.url;
    const full = path.join(siteDir, p);
    if (!fs.existsSync(full)) {
      res.writeHead(404);
      res.end("nf");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fs.readFileSync(full, "utf8"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

function siteTemplates() {
  return [
    {
      name: "counter",
      html: `<!doctype html><html><body><h1>Counter App</h1><button id='inc'>Increment</button><div id='state'>0</div><script>document.getElementById('inc').onclick=()=>{const s=document.getElementById('state');s.textContent=String(Number(s.textContent)+1)}</script></body></html>`
    },
    {
      name: "toggle",
      html: `<!doctype html><html><body><h1>Toggle App</h1><button id='toggle'>Toggle</button><p id='status'>OFF</p><script>document.getElementById('toggle').onclick=()=>{const s=document.getElementById('status');s.textContent=s.textContent==='OFF'?'ON':'OFF'}</script></body></html>`
    },
    {
      name: "form-echo",
      html: `<!doctype html><html><body><h1>Echo Form</h1><input id='name' /><button id='submit'>Submit</button><div id='state'>idle</div><script>document.getElementById('submit').onclick=()=>{const n=document.getElementById('name');document.getElementById('state').textContent=n.value||'submitted'}</script></body></html>`
    },
    {
      name: "todo-add",
      html: `<!doctype html><html><body><h1>Todo</h1><button id='add'>Add</button><div id='status'>0 items</div><script>let n=0;document.getElementById('add').onclick=()=>{n+=1;document.getElementById('status').textContent=n+' items'}</script></body></html>`
    },
    {
      name: "wizard-step",
      html: `<!doctype html><html><body><h1>Wizard</h1><button id='next'>Next</button><div id='state'>step-1</div><script>document.getElementById('next').onclick=()=>{document.getElementById('state').textContent='step-2'}</script></body></html>`
    }
  ];
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-agentic-5x-"));
  fs.writeFileSync(path.join(tmp, ".env"), "GEMINI_API_KEY=\n", "utf8");
  const manager = new AgenticLoopManager(tmp);

  const templates = siteTemplates();
  const results = [];

  for (const tpl of templates) {
    const siteDir = mkSite(tmp, tpl.name, tpl.html);
    const { server, url } = await startServer(siteDir);
    try {
      const draft = await manager.createDraft({ projectName: tpl.name, url, objective: `Validate ${tpl.name} flow` });
      const runResult = await manager.confirmAndRun({
        forestId: draft.forestId,
        treeId: draft.tree.treeId,
        url,
        additions: "",
        skipCodex: true
      });

      results.push({ name: tpl.name, status: runResult.run.status, artifacts: runResult.run.artifacts.length });
      assert.equal(runResult.run.status, "pass", `${tpl.name} should pass | ${runResult.run.summary}`);
      assert.ok(runResult.run.videoPath, `${tpl.name} should produce video`);
    } finally {
      server.close();
    }
  }

  assert.equal(results.length, 5, "expected 5 scenarios");
  console.log("agentic_examples.test.js passed", results);
}

run().catch((error) => {
  if (String(error.message || "").includes("spawn EPERM")) {
    console.log("agentic_examples.test.js skipped (sandbox denied browser launch)");
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
