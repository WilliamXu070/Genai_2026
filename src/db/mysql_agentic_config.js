const fs = require("node:fs");
const path = require("node:path");

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseDotEnvFile() {
  const projectRoot = process.env.JUNGLE_PROJECT_ROOT || process.cwd();
  const envPath = path.join(projectRoot, ".env");
  const out = {};

  if (!fs.existsSync(envPath)) {
    return out;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    out[key] = value;
  }

  return out;
}

function getAgenticMySqlConfig() {
  const envFile = parseDotEnvFile();
  const env = {
    ...envFile,
    ...process.env
  };
  const hasHost = Boolean(env.MYSQL_HOST);
  const hasUrl = Boolean(env.MYSQL_URL);
  const enabled = toBool(env.MYSQL_AGENTIC_ENABLED, hasHost || hasUrl);

  return {
    enabled,
    uri: env.MYSQL_URL || "",
    host: env.MYSQL_HOST || "127.0.0.1",
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || "root",
    password: env.MYSQL_PASSWORD || "root",
    database: env.MYSQL_DATABASE || "jungle_agentic",
    connectionLimit: Number(env.MYSQL_POOL_LIMIT || 5)
  };
}

module.exports = {
  getAgenticMySqlConfig
};
