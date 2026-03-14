const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { AgenticLoopManager } = require("../src/runtime/agentic_loop");

function makeSite(root) {
  const siteDir = path.join(root, "site");
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(
    path.join(siteDir, "index.html"),
    `<!doctype html><html><body>
      <h1>Test App</h1>
      <button id="go">Run</button>
      <div id="state">idle</div>
      <script>
        document.getElementById('go').addEventListener('click', ()=>{
          document.getElementById('state').textContent = 'pass';
        });
      </script>
    </body></html>`,
    "utf8"
  );
  return siteDir;
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

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jungle-agentic-"));
  fs.writeFileSync(path.join(tmp, ".env"), "GEMINI_API_KEY=\n", "utf8");

  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const site = makeSite(tmp);
  const { server, url } = await startServer(site);

  try {
    const manager = new AgenticLoopManager(tmp);
    const draft = await manager.createDraft({ projectName: "Test", url, objective: "validate flow" });

    assert.ok(draft.forestId, "missing forestId");
    assert.ok(draft.tree.treeId, "missing treeId");

    const runResult = await manager.confirmAndRun({
      forestId: draft.forestId,
      treeId: draft.tree.treeId,
      url,
      additions: ""
    });

    assert.ok(runResult.run.runId, "run id missing");
    assert.ok(["pass", "fail"].includes(runResult.run.status), "unexpected run status");
    assert.ok(Array.isArray(runResult.run.artifacts), "missing artifacts");

    const fork = await manager.forkTree({
      forestId: draft.forestId,
      fromTreeId: draft.tree.treeId,
      notes: "fork variation"
    });
    assert.ok(fork.treeId, "fork tree missing id");

    const redo = await manager.redoRun({
      forestId: draft.forestId,
      treeId: fork.treeId,
      url,
      additions: "redo variant"
    });
    assert.ok(redo.run.runId, "redo run missing id");

    const runs = manager.listRuns(draft.forestId);
    assert.ok(runs.length >= 2, "expected at least two runs in forest");

    console.log("agentic_loop.test.js passed");
  } finally {
    server.close();
    if (oldKey) process.env.GEMINI_API_KEY = oldKey;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
