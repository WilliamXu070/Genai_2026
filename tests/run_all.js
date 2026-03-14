const { spawnSync } = require("node:child_process");
const path = require("node:path");

const tests = [
  "store.test.js",
  "runner.test.js",
  "manager.test.js",
  "runtime.test.js",
  "operational_example.test.js",
  "agentic_loop.test.js",
  "agentic_examples.test.js"
];

for (const file of tests) {
  const full = path.join(__dirname, file);
  const result = spawnSync(process.execPath, [full], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("All tests passed");
