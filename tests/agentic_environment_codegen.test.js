const assert = require("node:assert");

const { buildRequestParser, generatePlaywrightProgram } = require("../src/runtime/agentic_loop");

(() => {
  const parser = buildRequestParser({
    steps: [
      { action: "assertVisible", target: "text=Dashboard" },
      { action: "click", target: "#launch" },
      { action: "screenshot", target: "fullPage" }
    ]
  });

  const program = generatePlaywrightProgram(parser, 400, {
    targetType: "electron_app",
    playwrightMode: "electron",
    launchTarget: {
      kind: "electron_app",
      value: "C:\\demo"
    }
  });

  assert.match(program, /_electron: electron/);
  assert.match(program, /electron\.launch/);
  assert.doesNotMatch(program, /chromium\.launch/);
})();

(() => {
  const parser = buildRequestParser({
    steps: [
      { action: "goto", target: "/" },
      { action: "assertVisible", target: "text=Landing" }
    ]
  });

  const program = generatePlaywrightProgram(parser, 400, {
    targetType: "web_frontend",
    playwrightMode: "web",
    launchTarget: {
      kind: "url",
      value: "http://127.0.0.1:3000"
    }
  });

  assert.match(program, /chromium\.launch/);
  assert.match(program, /page\.goto/);
})();

console.log("agentic_environment_codegen.test.js passed");
