const path = require("node:path");

function normalizeRuntimeRoots(input, options = {}) {
  const candidate = typeof input === "string" ? { workspaceRoot: input } : input || {};
  const workspaceRoot = path.resolve(candidate.workspaceRoot || candidate.projectRoot || process.cwd());
  const envStorageRoot = options.useEnv === false ? "" : process.env.JUNGLE_STORAGE_ROOT || "";
  const storageRoot = path.resolve(candidate.storageRoot || envStorageRoot || workspaceRoot);

  return {
    workspaceRoot,
    storageRoot
  };
}

module.exports = {
  normalizeRuntimeRoots
};
