# Repository Guidelines

## Project Structure & Module Organization
This repository is an Electron desktop app with a local runtime engine and optional Postgres bootstrap files. Keep app logic under `src/` and avoid editing `node_modules/`.

- `src/main.js`: Electron main process, IPC handlers, and runtime wiring.
- `src/preload.js`: safe IPC bridge exposed to the renderer via `contextBridge`.
- `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css`: renderer shell, behavior, and styling.
- `src/runtime/*.js`: runtime orchestration (`manager`, `runner`, `store`, `agentic_loop`, `operational_example`).
- `src/db/config.js`: database configuration helpers (`DATABASE_URL` and Postgres env defaults).
- `db/init/001-setup.sql`: Postgres bootstrap schema (mounted by Docker init).
- `tests/*.test.js` and `tests/run_all.js`: Node-based test suite and runner.
- `package.json` and `package-lock.json`: dependency and script definitions.

If you add assets or styles, place them under `src/renderer/` so the renderer stays self-contained.

## Build, Test, and Development Commands
- `npm install`: install or refresh dependencies after `package.json` changes.
- `npm start`: launch the Electron app.
- `npm run dev`: currently the same as `npm start`; use for local iteration.
- `npm test`: run the automated runtime test suite (`tests/run_all.js`).
- `npm run simulate:ops`: run the operational runtime example.
- `npm run db:start|db:status|db:logs|db:stop|db:down`: manage local Postgres via Docker Compose.

There is no packaged build script yet. If you add one, document the output directory and required tooling in `package.json`.

## Coding Style & Naming Conventions
Follow the existing JavaScript style in `src/`:

- Use 2-space indentation, double quotes, and semicolons.
- Prefer `const` by default and `let` only when reassignment is required.
- Use `camelCase` for variables and functions, and clear verb-based names.
- Keep responsibilities separated: Electron main process (`src/main.js`), preload bridge (`src/preload.js`), renderer DOM logic (`src/renderer/renderer.js`), and runtime logic (`src/runtime/`).

No formatter or linter is configured yet, so match the surrounding file style closely and keep changes minimal.

## Testing Guidelines
Automated tests exist and should be run for runtime changes:

1. Run `npm test`.
2. Confirm all tests in `tests/run_all.js` pass.
3. For renderer or IPC changes, also do a manual smoke test with `npm start`.

Manual smoke test checklist:
1. App window opens.
2. Runtime panels load and refresh.
3. Changed controls and IPC flows execute without errors.

Keep tests in `tests/` and name files `*.test.js`.

## Commit & Pull Request Guidelines
Local Git history is not available in this workspace, so use short, imperative commit messages such as `Add terminal session cleanup`. Keep pull requests focused and include:

- a brief summary of behavior changes,
- linked issue or task context when available,
- screenshots or short recordings for renderer/UI updates,
- manual verification steps performed.

## Security & Configuration Tips
Do not expose Node APIs directly to the renderer. Route privileged actions through `src/preload.js` and IPC handlers, and keep `contextIsolation` enabled.

Keep secrets in `.env` only; never hardcode credentials or API keys in source files.
