const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

function makeToken(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createScenarioHtml(spec) {
  const titleId = makeToken("title");
  const buttonId = makeToken("btn");
  const stateId = makeToken("state");
  const heading = `Scenario ${spec.name} ${makeToken("h")}`;
  const beforeText = makeToken("before");
  const afterText = makeToken("after");

  const includesButton = spec.behavior !== "missing_button";
  const mutationScript =
    spec.behavior === "changes_state"
      ? `document.getElementById("${stateId}").textContent = "${afterText}";`
      : `document.getElementById("${stateId}").textContent = "${beforeText}";`;

  const buttonMarkup = includesButton ? `<button id="${buttonId}">Execute</button>` : "";

  const html = `<!doctype html>
<html>
  <body>
    <h1 id="${titleId}">${heading}</h1>
    ${buttonMarkup}
    <div id="${stateId}">${beforeText}</div>
    <script>
      const button = document.getElementById("${buttonId}");
      if (button) {
        button.addEventListener("click", () => {
          ${mutationScript}
        });
      }
    </script>
  </body>
</html>`;

  return {
    html,
    expected: {
      behavior: spec.behavior,
      titleSelector: `#${titleId}`,
      stateSelector: `#${stateId}`,
      beforeText,
      afterText
    }
  };
}

function writeSite(rootDir, name, html) {
  const siteDir = path.join(rootDir, name);
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, "index.html"), html, "utf8");
  return siteDir;
}

function startStaticServer(siteDir) {
  const server = http.createServer((req, res) => {
    const reqPath = req.url === "/" ? "/index.html" : req.url;
    const fullPath = path.join(siteDir, reqPath);
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(fullPath, "utf8"));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

module.exports = {
  createScenarioHtml,
  startStaticServer,
  writeSite
};

