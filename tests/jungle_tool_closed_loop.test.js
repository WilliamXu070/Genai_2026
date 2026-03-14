const assert = require("node:assert");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const request = {
  requestId: `closed_loop_${Date.now()}`,
  type: "jungle:start-run",
  payload: {
    projectName: "Jungle",
    scenarioName: "Closed loop bridge test",
    steps: [{ action: "assert", target: "closed-loop" }],
    url: "http://127.0.0.1:3000"
  }
};

const ioDir = path.join(repoRoot, "Testing", ".jungle_tool_io");
fs.mkdirSync(ioDir, { recursive: true });
const requestPath = path.join(ioDir, `closed_loop_req_${Date.now()}.json`);
fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf8");

const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, "Testing", "tools", "jungle_tool_bridge.js"),
    "--input-file",
    requestPath,
    "--timeout-ms",
    "120000"
  ],
  {
    cwd: repoRoot,
    encoding: "utf8"
  }
);

if (result.error && result.error.code === "EPERM") {
  console.log("jungle_tool_closed_loop.test.js skipped (sandbox denied child process spawn)");
  process.exit(0);
}

assert.equal(result.status, 0, `Bridge command failed: ${result.stderr || result.error?.message}`);
const raw = (result.stdout || "").trim();
assert.ok(raw, "Expected JSON response from bridge tool");

const response = JSON.parse(raw);
assert.equal(response.ok, true, "Bridge response should be ok=true");
assert.equal(response.requestId, request.requestId);
assert.equal(response.result.scenarioName, request.payload.scenarioName);
assert.equal(response.result.status, "pass");
assert.equal(Array.isArray(response.result.steps), true);
assert.equal(response.result.steps.length > 0, true);

console.log("jungle_tool_closed_loop.test.js passed");
