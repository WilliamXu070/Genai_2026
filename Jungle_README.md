# Jungle

**Jungle** is a runtime intelligence layer for coding agents. Instead of only letting an agent write code and guess whether it works, Jungle spins up a fresh execution world, runs the software, tests real flows, captures structured evidence of what happened, and returns that evidence for repair.

For the hackathon, Jungle is intentionally scoped as a **sharp MVP**: one strong vertical slice that proves the idea works.

---

## 1. Hackathon Thesis

Most current agent systems already let models:
- write code
- run commands
- interact with a browser
- inspect screenshots or logs

Jungle is different because it is not just “an agent with browser access.”

Jungle adds capabilities that the coding agent does not naturally have on its own:
- **navigable runtime memory** across runs
- **controlled perturbation** of the execution world
- **structured runtime evidence** instead of vague pass/fail
- **repeatable reruns** from a known state
- **one place to observe software behavior live**

### Core positioning

> Jungle is a debugging environment that gives coding agents capabilities they did not have before.

---

## 2. What We Are Actually Building

### Final vision
Jungle should eventually evaluate anything an agent builds, as long as the result produces observable signals.

That includes:
- websites
- local applications
- frontend behavior
- backend behavior
- database mutations
- queue / cache state
- auth state
- agent workflows

### Hackathon MVP
For the hackathon, we will **not** build universal support.

We will build one strong, memorable vertical slice:
- one full-stack web app flow
- one fresh isolated run environment
- one visible browser execution
- one structured artifact bundle
- one rerun / repair loop
- one or two perturbation profiles
- one persistent run history

This is enough to prove the broader Jungle concept.

---

## 3. Why This Is Not Just a GPT Wrapper

Jungle becomes wrapper-like if the main story is:
- LLM writes code
- LLM tests app
- LLM fixes code

Jungle avoids that by making the **runtime system** the product.

### The model is only one module
The coding model is the **patch generator**.

Jungle owns:
- environment lifecycle
- browser execution
- evidence capture
- run storage
- artifact playback
- perturbation control
- rerun comparison

### Non-wrapper capabilities Jungle adds
- **Navigable runtime memory**
  - Every run is stored as structured execution state, not just chat context.
- **Controlled perturbation**
  - Jungle can deliberately test alternate realities like slow network or expired auth.
- **Cross-run comparison**
  - Jungle can compare what changed between runs.
- **Structured evidence**
  - screenshot, logs, network failures, step trace, and result all come back in one bundle.

If the model were swapped out, Jungle should still work as the same system.

---

## 4. Key Differentiation From Existing Designs

### Existing browser-agent tools
Most current solutions focus on:
- giving the model browser actions
- letting the model use tools
- helping the model interact with software

### Jungle
Jungle focuses on:
- creating a repeatable execution world
- running the software inside that world
- showing the test live
- recording what happened
- storing the run for future replay / comparison
- optionally perturbing the environment and observing new failure modes

### Important distinction
Existing tools mainly give agents **actions**.
Jungle gives agents an **execution substrate with memory and controlled variation**.

---

## 5. Main Product Concepts

### Forest
A **Forest** is a reusable environment template.

For the MVP, we only need **one forest**.

Example:
- `web-react-auth`

A forest defines:
- base runtime image
- services needed
- startup command expectations
- health check
- supported perturbations
- observability layers

### Run
A **Run** is one fresh launched instance of the current project using the forest.

A run stores:
- scenario
- timestamps
- logs
- artifacts
- result
- perturbation profile

### Tree / version history
A **Tree** is the future-facing version graph of previous runs, branches, and alternate states.

For the MVP, this should mostly stay in the background.
The user-facing object should be the **Run**, not the full forest/tree abstraction.

---

## 6. MVP User Flow

### High-level flow
1. Codex terminal calls Jungle through MCP.
2. Jungle opens the active run window.
3. A fresh run environment is created from the predefined forest.
4. The app starts with a terminal command such as `npm run dev`.
5. Jungle waits for the app to become ready.
6. The requested test is normalized into a structured plan.
7. Playwright executes the plan in a visible browser.
8. Jungle records video, trace, logs, screenshot, and step results.
9. Jungle stores the run in the database.
10. Jungle returns a structured result bundle to Codex.
11. Codex can patch and rerun.

### UI framing
The Jungle window should feel like a live testing room.

Suggested first screen:
- project name
- scenario name
- status: `Starting environment`
- message: **WELCOME TO THE JUNGLE**

### Important MVP simplification
For the hackathon, do **not** make the user navigate many forest/tree menus before testing starts.

Focus the user flow around:
- run
- test
- watch
- inspect
- rerun

---

## 7. The Testing Orchestration Flow

### Codex → MCP → Jungle
Codex initiates the testing procedure through an MCP tool call.

That tool call should contain:
- goal
- start command
- base URL
- scenario description
- steps or high-level requested behavior
- assertions
- optional perturbation profile

Example normalized request:

```json
{
  "command": "npm run dev",
  "url": "http://127.0.0.1:3000",
  "steps": [
    {"action": "goto", "target": "/"},
    {"action": "click", "target": "text=Sign Up"},
    {"action": "fill", "target": "input[name=email]", "value": "test@example.com"},
    {"action": "click", "target": "button[type=submit]"}
  ],
  "assertions": [
    {"type": "url_contains", "value": "/dashboard"},
    {"type": "text_visible", "value": "Dashboard"}
  ]
}
```

### Request Parser
The Request Parser converts the high-level request into a normalized test plan.

Responsibilities:
- validate structure
- infer defaults
- normalize selectors/actions
- attach metadata
- pass the final plan to the executor

### Playwright Executor
The Playwright Executor converts the normalized plan into real browser actions.

It is responsible for:
- opening the browser
- navigating to the app
- running clicks/fills/navigation
- evaluating assertions
- recording the session
- streaming live step status back to the UI

Important:
- Playwright itself is prebuilt.
- **Our executor is custom code** that maps Jungle’s JSON plan to Playwright APIs.

---

## 8. Live Visibility During Testing

A major part of the MVP is that the user should be able to see what Jungle is testing in real time.

### What should be visible live
- the browser window itself
- the current test step
- completed steps
- current URL / route
- pass/fail state
- console errors
- network failures

### Best UI layout
- **Left:** live browser
- **Top right:** current scenario and current step
- **Middle right:** checklist of steps and status
- **Bottom right:** console/network/errors/result

### How to make the browser readable
Use:
- headed browser mode
- `slowMo` so actions can be followed
- optional in-page overlay showing “Testing: Click Sign Up”

### Playback after completion
After the test finishes, Jungle should make available:
- video replay
- Playwright trace
- final screenshot

Live execution matters more than replay, but replay is valuable for later review.

---

## 9. MVP Artifact Bundle

Each run should return a compact structured result bundle.

Example:

```json
{
  "status": "fail",
  "failed_step": 4,
  "reason": "Submit did not navigate to /dashboard",
  "video": "runs/42/video.webm",
  "trace": "runs/42/trace.zip",
  "screenshot": "runs/42/final.png",
  "console_errors": [
    "TypeError: cannot read property 'id' of undefined"
  ]
}
```

### Required MVP artifacts
- final screenshot
- step results
- console logs
- failed network requests
- trace file
- video file
- overall result

---

## 10. Navigable Runtime Memory

This is one of Jungle’s key differentiators.

Runtime memory should **not** live primarily in chat history.
It should live in Jungle’s database.

### What runtime memory means
Jungle remembers:
- previous runs
- scenario definitions
- what failed
- what was tested
- what perturbation was used
- what artifacts were captured

### MVP version
For the hackathon, runtime memory can be simple:
- run history list
- stored artifacts per run
- quick rerun of last scenario

### Future version
Later, runtime memory can evolve into:
- checkpoints
- branches
- patch comparisons
- alternate “tree” versions
- replay from specific failure states

---

## 11. Controlled Perturbation

Controlled perturbation is a second major differentiator.

Jungle should be able to deliberately change the execution conditions and observe how behavior changes.

### Why this matters
A coding agent normally tests one happy-path reality.
Jungle should be able to test alternate realities.

### MVP perturbations
Implement only **one or two**:
- slow network
- expired auth / token

### Future perturbations
- API 500s
- empty database state
- missing environment variable
- mobile viewport
- delayed backend response

### Product principle
The value is not just running the software.
The value is running the software under **controlled alternate conditions**.

---

## 12. Database Design for the MVP

Keep the schema simple.

### Minimum tables / entities
- `projects`
- `runs`
- `scenarios`
- `artifacts`
- `logs`

### Suggested run fields
- `run_id`
- `project_id`
- `scenario_name`
- `forest_id`
- `status`
- `plan_json`
- `start_time`
- `end_time`
- `perturbation_profile`
- `result_summary`

### Suggested artifact fields
- `artifact_id`
- `run_id`
- `type`
- `path`
- `metadata`

For the MVP, store artifacts on disk and metadata in SQLite or Postgres.

---

## 13. Tech Stack Recommendation

### Recommended stack

#### 1. Codex + MCP
Use Codex as the coding agent and MCP as the control interface into Jungle.

Why:
- Codex supports MCP in both the CLI and IDE extension.
- MCP gives Jungle a clean tool interface instead of coupling Jungle directly into the agent.

#### 2. Langflow
Use Langflow only for **orchestration of the website tester**, not as the browser runtime itself.

Langflow should:
- expose the orchestration flow as an MCP tool
- receive the testing request
- normalize it
- call the executor components
- return the final bundle

Langflow should **not** be responsible for all runtime state forever. It should orchestrate, not become the sandbox.

#### 3. Playwright
Use Playwright for browser execution.

Why:
- reliable browser control
- headed mode for live demo
- trace capture
- video recording
- assertions
- good debugging experience

#### 4. Docker
Use Docker to create the isolated run environment.

Why:
- clean run isolation
- repeatable environment setup
- future support for multiple forest templates
- easy packaging for demos

#### 5. Backend service for Jungle runtime
Use one lightweight runtime service.

Best options:
- **Node.js + TypeScript** if the team is stronger in JS/TS and Playwright integration
- **Python + FastAPI** if the team prefers Python for orchestration

### Best overall recommendation
For this MVP:
- **Node.js + TypeScript** for the Jungle runtime service
- **Playwright** for browser execution
- **Langflow** for orchestration / MCP-exposed flow
- **Docker** for the forest environment
- **SQLite** for simple run storage
- **React / Next.js / Electron / Tauri UI** depending on how the team wants to present the Jungle window

### Simplest practical recommendation
If speed matters most:
- Langflow
- Node.js + TypeScript runtime
- Playwright
- Docker
- SQLite
- small React dashboard

That is the cleanest hackathon stack.

---

## 14. Recommended System Architecture

```text
Codex terminal
  -> MCP tool call
Langflow orchestration flow
  -> Request Parser
  -> Start App Server
  -> Ready Check
  -> Playwright Executor
  -> Artifact Collector
  -> Result Formatter
Jungle runtime storage
  -> SQLite/Postgres + artifact files
Jungle UI
  -> live browser + step status + run history
```

### Component responsibilities

#### Codex
- edits code
- triggers tests
- receives result bundle
- decides whether to patch and rerun

#### Langflow
- orchestrates the testing procedure
- exposes the flow as an MCP tool
- normalizes request data
- routes between execution components

#### Jungle Runtime Service
- manages run state
- starts the local app command
- checks readiness
- stores run metadata and artifacts

#### Playwright Executor
- performs the browser actions
- evaluates assertions
- records video / trace
- emits live test status

#### Jungle UI
- shows the run live
- shows current step and status
- plays back artifacts after completion
- lets the user rerun the last scenario

---

## 15. Exact MVP Feature List

### Must build
- one predefined forest template
- start app from terminal command
- readiness check
- request parser
- Playwright execution of one scenario
- live headed browser
- live step/status panel
- screenshot + trace + video capture
- artifact storage
- result bundle returned to Codex
- run history
- rerun last scenario

### Nice to have
- one perturbation profile
- quick compare between two runs
- overlay inside the browser indicating the current test step

### Do not build yet
- universal support for every software type
- complex tree version navigation
- multi-model orchestration
- advanced checkpoint branching
- many forest types
- large menu systems before the first run

---

## 16. Suggested MVP Demo Flow

### Demo 1: Broken flow, live detection
- Codex triggers Jungle test
- Jungle launches app
- Jungle runs visible browser test
- failure occurs
- artifacts appear in the UI

### Demo 2: Patch and rerun
- Codex patches the code
- same Jungle scenario reruns
- run history shows improvement

### Demo 3: Perturbed reality
- rerun the same flow with a perturbation such as slow network or expired auth
- show how Jungle reveals a different failure mode

This is enough to communicate the larger idea.

---

## 17. Immediate Build Plan

### Day 1
- define the MCP input schema
- define the normalized test plan schema
- create the Jungle runtime skeleton
- connect Codex → MCP → Langflow

### Day 2
- implement app startup + ready check
- implement Playwright executor
- implement artifact capture
- show live browser execution

### Day 3
- build the Jungle UI panel
- store run data in SQLite
- implement rerun last scenario
- polish demo flow

### If extra time remains
- add one perturbation
- add quick run comparison
- add browser overlay labels

---

## 18. Official Docs That Support This Stack

- Langflow can expose flows as MCP tools: https://docs.langflow.org/mcp-server
- Langflow supports MCP tools/components: https://docs.langflow.org/mcp-tools
- Codex supports MCP in the CLI and IDE extension: https://developers.openai.com/codex/mcp/
- Playwright supports headed mode and `slowMo`: https://playwright.dev/docs/debug
- Playwright supports visible/headed execution: https://playwright.dev/docs/running-tests
- Playwright supports trace viewer and debugging artifacts: https://playwright.dev/docs/trace-viewer
- Docker BuildKit is the default modern build backend: https://docs.docker.com/build/buildkit/
- Docker images use layered image construction: https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/

---

## 19. Final Project Summary

Jungle is a live debugging environment for coding agents.

For the hackathon MVP, Jungle will:
- accept a test request from Codex through MCP
- create a fresh run environment from one forest template
- launch the local app
- execute a real browser test visibly with Playwright
- record a structured artifact bundle
- store the run in a database
- return the result back to Codex for rerun or repair

The two most important differentiators in the MVP are:
- **navigable runtime memory**
- **controlled perturbation**

Those are the foundations that make Jungle more than just another agent wrapper or browser tester.
