# Jungle macOS Setup

This repo is portable to macOS in developer-repo mode. The current pipeline still expects external system dependencies:

- Node.js 22+
- Python 3.11+
- Docker Desktop
- MySQL container for the approval-gated agentic pipeline

## 1. Install JavaScript dependencies

```bash
npm install
npx playwright install chromium
```

## 2. Install Python sidecar

```bash
cd langflow_orchestrator
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
cd ..
```

## 3. Choose a shared storage root

The desktop app and external `jungle-agentic` CLI should point at the same writable runtime directory.

```bash
export JUNGLE_STORAGE_ROOT="$HOME/.jungle/runtime"
mkdir -p "$JUNGLE_STORAGE_ROOT"
```

Optional:

```bash
cp .env "$JUNGLE_STORAGE_ROOT/.env"
```

## 4. Start MySQL

```bash
npm run db:mysql:start
npm run db:mysql:status
```

Apply the current migration set against your MySQL instance before running the desktop app.

## 5. Launch Jungle

```bash
npm start
```

## 6. Use the global CLI from any directory

After `npm install`, npm exposes the `jungle-agentic` binary through the package `bin` entry.

Example:

```bash
jungle-agentic \
  --project-root "$HOME/Downloads/my-app" \
  --project-name "My App" \
  --task "Test the landing page flow and pause for approval" \
  --url "http://127.0.0.1:3000" \
  --storage-root "$JUNGLE_STORAGE_ROOT"
```

## Packaging Notes

- The app now stores mutable runtime state outside the app bundle.
- `electron-builder` is configured for macOS packaging, but the packaged app still expects:
  - system Python
  - Docker/MySQL
  - environment variables or `.env` in the shared storage root

Build commands:

```bash
npm run rebuild:native
npm run dist:mac
```
