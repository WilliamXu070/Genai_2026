# Progress

## Current Status (2026-03-14)

### Core Jungle MVP (existing backend)
- [x] Runtime run manager with persistent run storage (`db/runs.json`, `db/runs/*` artifacts)
- [x] MVP scenario runner pipeline (`start -> ready-check -> step execution -> artifact bundle`)
- [x] Electron IPC integration for Jungle runtime
- [x] Live renderer panel for run status, step stream, and run history
- [x] Runtime smoke test coverage in `npm test`

### New Isolated Sandbox Backend (separate from current backend)
- [x] Added standalone storage/service module at `src/sandbox_backend/`
- [x] Added separate schema file: `db/init/002-sandbox-backend.sql`
- [x] Implemented navigable runtime memory graph (run nodes + parent edges)
- [x] Implemented `redoPreviousTest(runId)` workflow
- [x] Implemented `branchFromPreviousRun(runId, branchName, scenarioId)` workflow
- [x] Implemented environment versioning fields (Docker digest, env fingerprint, perturbation profile)
- [x] Implemented hotload payload generation (`quick` and `full`)
- [x] Implemented run comparison storage (`compareRuns`)
- [x] Added simulation harness: `tools/simulate_sandbox_backend.js`
- [x] Added test: `tests/sandbox_backend.test.js`

## What To Do Next

- [ ] Add HTTP API wrapper for `SandboxBackendService` (read/write endpoints for UI/MCP)
- [ ] Build timeline endpoints (`/timeline`, `/runs/:id`, `/runs/:id/redo`, `/runs/:id/branch`)
- [ ] Build hotload endpoint (`/runs/:id/hotload?mode=quick|full`)
- [ ] Add comparison endpoint (`/runs/compare`)
- [ ] Connect renderer timeline panel in read-only mode first
- [ ] Decide integration strategy: keep isolated backend separate or gradually bridge into current runtime path

## Notes

- Current backend code under `src/runtime/` was not modified to depend on the new module.
- The new sandbox backend currently persists to `db/sandbox_backend.json` for local simulation.
- Command to run simulation: `npm run simulate:sandbox-backend`.
