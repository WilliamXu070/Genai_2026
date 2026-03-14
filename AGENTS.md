# Repository Guidelines

## Project Structure & Module Organization
This repository is a small Electron desktop app. Keep app logic under `src/` and avoid editing `node_modules/`.

- `src/main.js`: Electron main process, window lifecycle, and terminal process management.
- `src/preload.js`: safe bridge between Electron IPC and the renderer via `contextBridge`.
- `src/renderer/index.html`: app shell markup.
- `src/renderer/renderer.js`: renderer-side UI behavior and terminal wiring.
- `package.json` and `package-lock.json`: dependency and script definitions.

If you add assets or styles, place them under `src/renderer/` so the renderer stays self-contained.

## Build, Test, and Development Commands
- `npm install`: install or refresh dependencies after `package.json` changes.
- `npm start`: launch the Electron app.
- `npm run dev`: currently the same as `npm start`; use for local iteration.

There is no packaged build script yet. If you add one, document the output directory and required tooling in `package.json`.

## Coding Style & Naming Conventions
Follow the existing JavaScript style in `src/`:

- Use 2-space indentation, double quotes, and semicolons.
- Prefer `const` by default and `let` only when reassignment is required.
- Use `camelCase` for variables and functions, and clear verb-based names such as `createTerminalSession`.
- Keep Electron responsibilities separated: main-process code in `src/main.js`, renderer DOM code in `src/renderer/renderer.js`, and IPC exposure in `src/preload.js`.

No formatter or linter is configured yet, so match the surrounding file style closely and keep changes minimal.

## Testing Guidelines
There is no automated test suite in the current workspace. For now, verify changes with a manual smoke test:

1. Run `npm start`.
2. Confirm the window opens and the embedded terminal connects.
3. Exercise changed UI controls and IPC flows, such as `Run \`codex\`` or quick command buttons.

If you add tests, keep them in a new `tests/` directory and name files `*.test.js`.

## Commit & Pull Request Guidelines
Local Git history is not available in this workspace, so use short, imperative commit messages such as `Add terminal session cleanup`. Keep pull requests focused and include:

- a brief summary of behavior changes,
- linked issue or task context when available,
- screenshots or short recordings for renderer/UI updates,
- manual verification steps performed.

## Security & Configuration Tips
Do not expose Node APIs directly to the renderer. Route privileged actions through `src/preload.js` and IPC handlers, and keep `contextIsolation` enabled.
