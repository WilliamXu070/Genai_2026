const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8093);
const PUBLIC_DIR = path.join(__dirname, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const raw = (req.url || "/").split("?")[0];
  // Use POSIX normalization for URL paths so "/" stays stable across platforms.
  const safePath = path.posix.normalize(raw).replace(/^(\.\.\/)+/, "");
  const relative = safePath === "/" ? "index.html" : safePath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, relative);
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  process.stdout.write(`bad-shm-visualizer listening on http://127.0.0.1:${PORT}\n`);
});
