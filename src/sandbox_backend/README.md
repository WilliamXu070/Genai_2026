# Sandbox Backend (Isolated Timeline Store)

This module is a separate backend simulation for Jungle timeline memory and hotloading.
It does not modify the current runtime backend behavior.

## Entry Point
- `src/sandbox_backend/index.js`
- main API class: `SandboxBackendService`

## Supported features
- Persist project/forest/scenario/environment-version/run data.
- Record step traces, artifacts, and state snapshots.
- Redo a previous test from saved state metadata.
- Branch from a previous run and execute a different scenario.
- Build a navigable runtime-memory graph (nodes + parent edges).
- Generate hotload bundles (`quick` or `full`) for replay.
- Compare two runs and persist a structured diff.

## Local storage file
- `db/sandbox_backend.json`

## Simulation
Run:

```bash
npm run simulate:sandbox-backend
```

It simulates Codex/MCP/UI/executor interactions against this isolated backend.
