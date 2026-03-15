const approvalCount = document.getElementById("approval-count");
const approvalList = document.getElementById("approval-list");
const approveRunButton = document.getElementById("approve-run");
const cancelRunButton = document.getElementById("cancel-run");
const createVariantRunButton = document.getElementById("create-variant-run");
const detailApprovalRequested = document.getElementById("detail-approval-requested");
const detailApproved = document.getElementById("detail-approved");
const detailContent = document.getElementById("detail-content");
const detailCreated = document.getElementById("detail-created");
const detailDraftPayload = document.getElementById("detail-draft-payload");
const detailEmpty = document.getElementById("detail-empty");
const detailError = document.getElementById("detail-error");
const detailExecutionStatus = document.getElementById("detail-execution-status");
const detailExecutionTime = document.getElementById("detail-execution-time");
const detailInstructionsEditor = document.getElementById("detail-instructions-editor");
const detailInstructions = document.getElementById("detail-instructions");
const detailLoopCount = document.getElementById("detail-loop-count");
const detailPanel = document.querySelector(".detail-panel");
const detailProjectName = document.getElementById("detail-project-name");
const detailRunId = document.getElementById("detail-run-id");
const detailSemanticSummary = document.getElementById("detail-semantic-summary");
const detailSemanticVerdict = document.getElementById("detail-semantic-verdict");
const detailStatus = document.getElementById("detail-status");
const detailSummary = document.getElementById("detail-summary");
const detailTitle = document.getElementById("detail-title");
const detailUpdated = document.getElementById("detail-updated");
const detailVideo = document.getElementById("detail-video");
const errorBlock = document.getElementById("error-block");
const inProgressList = document.getElementById("in-progress-list");
const loopList = document.getElementById("loop-list");
const instructionsEditHint = document.getElementById("instructions-edit-hint");
const instructionsEditWrap = document.getElementById("instructions-edit-wrap");
const progressCount = document.getElementById("progress-count");
const projectCount = document.getElementById("project-count");
const projectList = document.getElementById("project-list");
const previewMeta = document.getElementById("preview-meta");
const previewPathInput = document.getElementById("preview-path-input");
const previewTitleInput = document.getElementById("preview-title-input");
const previewTypeInput = document.getElementById("preview-type-input");
const refreshProjectsButton = document.getElementById("refresh-projects");
const runList = document.getElementById("run-list");
const runsMeta = document.getElementById("runs-meta");
const runsTitle = document.getElementById("runs-title");
const runsSection = runsTitle?.closest(".queue-section") || null;
const sessionStatus = document.getElementById("session-status");
const semanticFailureList = document.getElementById("semantic-failure-list");
const semanticInterpretationBlock = document.getElementById("semantic-interpretation-block");
const semanticRecommendationsList = document.getElementById("semantic-recommendations-list");
const semanticSuccessList = document.getElementById("semantic-success-list");
const saveInstructionsButton = document.getElementById("save-instructions");
const savePreviewButton = document.getElementById("save-preview");
const openPreviewButton = document.getElementById("open-preview");
const versionText = document.getElementById("version-text");
const videoMeta = document.getElementById("video-meta");

const ACTIVE_QUEUE_STATUSES = new Set(["drafting", "approved", "in_progress"]);
const APPROVABLE_STATUSES = new Set(["to_be_approved"]);
const CANCELLABLE_STATUSES = new Set(["drafting", "to_be_approved", "approved", "in_progress"]);
const FAILURE_STATUSES = new Set(["failed_execution", "cancelled"]);
const EVENT_REFRESH_DEBOUNCE_MS = 250;
const MAX_LOOP_DISPLAY = 5;

let activeProjectId = null;
let activeRunId = null;
let approvalRuns = [];
let inProgressRuns = [];
let projects = [];
let runs = [];
let loadingPromise = null;
let refreshDebounceHandle = null;
let removeAgenticEventListener = null;
let removeAgenticHistoryListener = null;
let projectsSignature = "";
let approvalRunsSignature = "";
let inProgressRunsSignature = "";
let runsSignature = "";
let runDetailSignature = "";
let runVersionMap = new Map();
let activeRunDetail = null;
let instructionDraftRunId = null;
let instructionDraftValue = "";
let instructionDraftDirty = false;
let timelineLimitObserver = null;

function setStatus(value) {
  if (sessionStatus && sessionStatus.textContent !== value) {
    sessionStatus.textContent = value;
  }
}

function toLocalFileUrl(filePath) {
  if (!filePath) {
    return "";
  }
  const normalized = String(filePath).replace(/\\/g, "/").replace(/^\/+/, "");
  return encodeURI(`file:///${normalized}`);
}

function resolveRunVideoReference(run) {
  if (run?.videoReference) {
    return run.videoReference;
  }
  const loops = Array.isArray(run?.loopIterations) ? run.loopIterations : [];
  for (const loop of loops) {
    const artifacts = loop?.artifacts && typeof loop.artifacts === "object" ? loop.artifacts : {};
    const directVideo = Array.isArray(artifacts.video_chunk_refs) ? artifacts.video_chunk_refs.find(Boolean) : "";
    if (directVideo) {
      return directVideo;
    }
    const artifactVideo = Array.isArray(artifacts.artifact_refs)
      ? artifacts.artifact_refs.find((entry) => String(entry?.path || "").toLowerCase().endsWith(".webm"))
      : null;
    if (artifactVideo?.path) {
      return artifactVideo.path;
    }
  }
  return "";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function formatDuration(ms) {
  const totalMs = Number(ms);
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    return "-";
  }
  if (totalMs < 1000) {
    return `${totalMs} ms`;
  }
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function normalizeSummary(summary) {
  if (!Array.isArray(summary)) {
    return ["No summary recorded.", "No summary recorded.", "No summary recorded."];
  }
  return [
    summary[0] || "No summary recorded.",
    summary[1] || "No summary recorded.",
    summary[2] || "No summary recorded."
  ];
}

function compactText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function getSemanticInterpretation(run) {
  if (!run || typeof run !== "object") {
    return null;
  }
  return run.semanticInterpretation || run.draftPayload?.semanticInterpretation || null;
}

function getSemanticVerdict(run) {
  const verdict = String(run?.semanticVerdict || getSemanticInterpretation(run)?.verdict || "")
    .trim()
    .toLowerCase();
  return verdict || "";
}

function formatSemanticVerdict(run) {
  const verdict = getSemanticVerdict(run);
  return verdict ? verdict.replace(/_/g, " ") : "pending";
}

function getDisplayStatus(run) {
  if (!run) {
    return "-";
  }
  if (run.status === "completed") {
    return formatSemanticVerdict(run);
  }
  if (run.status === "failed_execution") {
    return "execution failed";
  }
  return run.status || "-";
}

function sanitizeErrorText(value) {
  const raw = String(value || "");
  return raw
    .replace(/\u001b\[[0-9;]*m/g, " ")
    .replace(/\[[0-9;]*m/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatReadableFailure(rawError, fallbackSummary = "") {
  const raw = sanitizeErrorText(rawError);
  if (!raw) {
    const fallback = compactText(fallbackSummary, 160);
    return fallback || "Failure recorded. See run detail for context.";
  }

  const stepMatch = raw.match(/Failed at step\s+(\d+)/i);
  const stepText = stepMatch ? `Step ${stepMatch[1]}` : "Run step";
  const timeoutMatch = raw.match(/Timeout\s+(\d+)ms exceeded/i);
  const timeoutText = timeoutMatch ? `${timeoutMatch[1]}ms` : "timeout";
  const locatorMatch = raw.match(/locator\((['"`])(.+?)\1\)/i);
  const locatorText = locatorMatch ? locatorMatch[2] : "";

  if (/locator\.click/i.test(raw) && /timeout/i.test(raw)) {
    if (locatorText) {
      return `${stepText} timeout: could not click ${locatorText} within ${timeoutText}.`;
    }
    return `${stepText} timeout: click target was not ready within ${timeoutText}.`;
  }

  if (/assert|expect/i.test(raw) && /timeout/i.test(raw)) {
    return `${stepText} timeout: assertion did not pass within ${timeoutText}.`;
  }

  const cleaned = compactText(raw.replace(/Call log:.*$/i, "").trim(), 170);
  return cleaned || "Failure recorded. See run detail for context.";
}

function buildFailureFixHint(rawError) {
  const raw = sanitizeErrorText(rawError);
  if (!raw) {
    return "Fix: verify selectors and expected UI state before this step.";
  }
  if (/locator\.click/i.test(raw) && /timeout/i.test(raw)) {
    const locatorMatch = raw.match(/locator\((['"`])(.+?)\1\)/i);
    const locatorText = locatorMatch ? locatorMatch[2] : "the target selector";
    return `Fix: confirm ${locatorText} exists, is visible/enabled, and the flow reaches that screen before clicking.`;
  }
  if (/navigation|goto|net::|ERR_/i.test(raw)) {
    return "Fix: confirm the app URL/server is reachable and page navigation completes before assertions.";
  }
  if (/assert|expect/i.test(raw)) {
    return "Fix: align assertions with rendered text/state, or add an explicit wait for readiness.";
  }
  return "Fix: inspect loop artifacts and adjust selector timing or test steps.";
}

function summarizeFailure(run) {
  const primary = formatReadableFailure(run?.lastErrorText || "", normalizeSummary(run?.threePointSummary)[0]);
  if (primary) {
    return `Failure: ${primary}`;
  }
  const fallback = compactText(normalizeSummary(run?.threePointSummary)[0], 160);
  return fallback ? `Failure: ${fallback}` : "Failure recorded. See detail for context.";
}

function getRunSummaryText(run) {
  const semanticInterpretation = getSemanticInterpretation(run);
  if (run?.status === "completed" && semanticInterpretation?.summary) {
    return compactText(semanticInterpretation.summary, 170);
  }
  if (FAILURE_STATUSES.has(run?.status || "")) {
    return summarizeFailure(run);
  }
  return compactText(normalizeSummary(run?.threePointSummary)[0], 170) || "No summary recorded.";
}

function abbreviateRunId(runId) {
  const value = String(runId || "");
  if (!value) {
    return "-";
  }
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function createEmptyListItem(text) {
  const item = document.createElement("li");
  item.className = "empty-list-item";
  item.textContent = text;
  return item;
}

function toSignature(value) {
  return JSON.stringify(value);
}

function buildProjectsSignature(list) {
  return toSignature(
    (Array.isArray(list) ? list : []).map((project) => [
      project.id || "",
      project.name || "",
      project.updatedAt || project.updated_at || ""
    ])
  );
}

function buildQueueSignature(list) {
  return toSignature(
    (Array.isArray(list) ? list : []).map((run) => [
      run.id || "",
      run.projectId || "",
      run.projectName || "",
      run.status || "",
      run.semanticVerdict || "",
      Number(run.loopCount || 0),
      run.updatedAt || "",
      run.approvalRequestedAt || "",
      normalizeSummary(run.threePointSummary)
    ])
  );
}

function buildRunsSignature(list) {
  return toSignature(
    (Array.isArray(list) ? list : []).map((run) => [
      run.id || "",
      run.projectId || "",
      run.status || "",
      run.semanticVerdict || "",
      Number(run.loopCount || 0),
      Number(run.executionTimeMs || 0),
      run.updatedAt || "",
      run.videoReference || "",
      normalizeSummary(run.threePointSummary)
    ])
  );
}

function buildRunDetailSignature(run) {
  if (!run || typeof run !== "object") {
    return "";
  }
  const loops = Array.isArray(run.loopIterations) ? run.loopIterations : [];
  return toSignature({
    id: run.id || "",
    projectId: run.projectId || "",
    projectName: run.projectName || "",
    status: run.status || "",
    createdAt: run.createdAt || "",
    updatedAt: run.updatedAt || "",
    approvalRequestedAt: run.approvalRequestedAt || "",
    approvedAt: run.approvedAt || "",
    approvedBy: run.approvedBy || "",
    executionTimeMs: Number(run.executionTimeMs || 0),
    loopCount: Number(run.loopCount || 0),
    testingInstructions: run.testingInstructions || "",
    threePointSummary: normalizeSummary(run.threePointSummary),
    lastErrorText: run.lastErrorText || "",
    videoReference: run.videoReference || "",
    previewType: run.previewType || "",
    previewPath: run.previewPath || "",
    previewTitle: run.previewTitle || "",
    draftPayload: run.draftPayload || null,
    semanticVerdict: run.semanticVerdict || "",
    semanticInterpretation: getSemanticInterpretation(run),
    failureInterpretation: run.draftPayload?.failureInterpretation || null,
    loopIterations: loops.map((loop) => ({
      loopNumber: Number(loop.loopNumber || 0),
      status: loop.status || "",
      stepSummary: loop.stepSummary || "",
      updatedAt: loop.updatedAt || "",
      artifacts: loop.artifacts || null
    }))
  });
}

function toTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function runOrderKey(run) {
  const created = toTimestamp(run?.createdAt);
  if (created > 0) {
    return created;
  }

  const id = String(run?.id || "");
  const idTs = id.match(/(\d{11,})/);
  if (idTs) {
    const parsed = Number(idTs[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const updated = toTimestamp(run?.updatedAt);
  if (updated > 0) {
    return updated;
  }

  return 0;
}

function computeRunVersionMap(list) {
  const ordered = [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ta = runOrderKey(a);
    const tb = runOrderKey(b);
    return ta - tb;
  });
  const map = new Map();
  ordered.forEach((run, index) => {
    if (run?.id) {
      map.set(run.id, `v${index + 1}`);
    }
  });
  return map;
}

function getRunVersionLabel(run) {
  if (!run?.id) {
    return "v?";
  }
  return runVersionMap.get(run.id) || "v?";
}

function getRunDisplayLabel(run) {
  const version = getRunVersionLabel(run);
  if (version !== "v?") {
    return version;
  }
  return abbreviateRunId(run?.id);
}

function queueMeta(run) {
  if (run.status === "to_be_approved") {
    return `Requested ${formatDate(run.approvalRequestedAt)} | Loops ${run.loopCount || 0}/${MAX_LOOP_DISPLAY}`;
  }
  if (run.status === "completed") {
    return `Execution completed | Verdict ${formatSemanticVerdict(run)} | Loops ${run.loopCount || 0}/${MAX_LOOP_DISPLAY}`;
  }
  if (run.status === "failed_execution") {
    return `Execution failed | Loops ${run.loopCount || 0}/${MAX_LOOP_DISPLAY} | ${formatDate(run.updatedAt)}`;
  }
  return `Updated ${formatDate(run.updatedAt)} | Loops ${run.loopCount || 0}/${MAX_LOOP_DISPLAY}`;
}

function renderRunButton(run, options = {}) {
  const item = document.createElement("li");
  item.className = "run-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "entity-button run-button";
  button.dataset.active = String(run.id === activeRunId);

  const topRow = document.createElement("div");
  topRow.className = "run-card-top";

  const title = document.createElement("strong");
  const displayLabel = getRunDisplayLabel(run);
  title.textContent = options.showProject ? `${run.projectName || run.projectId} | ${displayLabel}` : displayLabel;
  title.title = run.id || "";

  const chip = document.createElement("span");
  chip.className = "status-chip";
  chip.dataset.status = getSemanticVerdict(run) || run.status || "drafting";
  chip.textContent = getDisplayStatus(run);

  topRow.appendChild(title);
  topRow.appendChild(chip);

  const summary = document.createElement("div");
  summary.className = "run-summary";
  summary.textContent = getRunSummaryText(run);

  const meta = document.createElement("div");
  meta.className = "entity-meta";
  meta.textContent = options.metaText || queueMeta(run);

  button.appendChild(topRow);
  button.appendChild(summary);
  button.appendChild(meta);
  button.addEventListener("click", () => {
    openRun(run.id, run.projectId || options.projectId || null).catch(() => {
      // surface errors via status text
    });
  });

  item.appendChild(button);
  return item;
}

function renderTimelineRunItem(run, index, projectId) {
  const item = document.createElement("li");
  item.className = "timeline-item";
  item.dataset.side = index % 2 === 0 ? "left" : "right";
  item.style.setProperty("--timeline-index", String(index));

  const node = document.createElement("span");
  node.className = "timeline-node";
  item.appendChild(node);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "entity-button timeline-card";
  button.dataset.active = String(run.id === activeRunId);

  const year = document.createElement("div");
  year.className = "timeline-year";
  year.textContent = new Date(run.createdAt || run.updatedAt || Date.now()).getFullYear().toString();

  const topRow = document.createElement("div");
  topRow.className = "run-card-top";

  const title = document.createElement("strong");
  title.textContent = getRunDisplayLabel(run);
  title.title = run.id || "";

  const chip = document.createElement("span");
  chip.className = "status-chip";
  chip.dataset.status = getSemanticVerdict(run) || run.status || "drafting";
  chip.textContent = getDisplayStatus(run);

  topRow.appendChild(title);
  topRow.appendChild(chip);

  const summary = document.createElement("div");
  summary.className = "run-summary";
  summary.textContent = getRunSummaryText(run);

  const meta = document.createElement("div");
  meta.className = "entity-meta";
  meta.textContent = `ID ${abbreviateRunId(run.id)} | Loops ${run.loopCount || 0}/${MAX_LOOP_DISPLAY} | ${formatDuration(run.executionTimeMs)} | ${formatDate(run.updatedAt)}`;

  button.appendChild(year);
  button.appendChild(topRow);
  button.appendChild(summary);
  button.appendChild(meta);
  button.addEventListener("click", () => {
    openRun(run.id, run.projectId || projectId || null).catch(() => {
      // surface errors via status text
    });
  });

  item.appendChild(button);
  return item;
}

function syncTimelineHeightLimit() {
  if (!runList || !runList.classList.contains("timeline-list")) {
    if (runList) {
      runList.style.height = "";
      runList.style.maxHeight = "";
    }
    if (runsSection) {
      runsSection.style.height = "";
      runsSection.style.maxHeight = "";
    }
    return;
  }

  if (!runsSection) {
    runList.style.height = "";
    runList.style.maxHeight = "";
    return;
  }

  // Hard limit is derived from the natural visible size of the Run Detail panel in the viewport.
  const detailRect = detailPanel?.getBoundingClientRect();
  if (!detailRect) {
    runsSection.style.height = "";
    runsSection.style.maxHeight = "";
    runList.style.height = "";
    runList.style.maxHeight = "";
    return;
  }
  const sectionRect = runsSection.getBoundingClientRect();
  const listRect = runList.getBoundingClientRect();

  const sectionOffset = Math.max(0, Math.floor(sectionRect.top - detailRect.top));
  const availableSectionHeight = Math.floor(detailRect.height - sectionOffset);
  if (!Number.isFinite(availableSectionHeight) || availableSectionHeight <= 0) {
    runsSection.style.height = "";
    runsSection.style.maxHeight = "";
    runList.style.height = "";
    runList.style.maxHeight = "";
    return;
  }
  const listTopOffset = Math.max(0, Math.floor(listRect.top - sectionRect.top));
  const availableListHeight = Math.floor(availableSectionHeight - listTopOffset);
  if (!Number.isFinite(availableListHeight) || availableListHeight <= 0) {
    runsSection.style.height = "";
    runsSection.style.maxHeight = "";
    runList.style.height = "";
    runList.style.maxHeight = "";
    return;
  }

  const sectionHeight = `${availableSectionHeight}px`;
  const listHeight = `${availableListHeight}px`;
  runsSection.style.height = sectionHeight;
  runsSection.style.maxHeight = sectionHeight;
  runList.style.height = listHeight;
  runList.style.maxHeight = listHeight;
}

function bindTimelineHeightLimit() {
  if (timelineLimitObserver) {
    timelineLimitObserver.disconnect();
    timelineLimitObserver = null;
  }

  const limitElement = detailVideo?.closest(".content-block") || detailPanel;
  if (!limitElement || typeof ResizeObserver !== "function") {
    requestAnimationFrame(syncTimelineHeightLimit);
    return;
  }

  timelineLimitObserver = new ResizeObserver(() => {
    syncTimelineHeightLimit();
  });
  timelineLimitObserver.observe(limitElement);
  requestAnimationFrame(syncTimelineHeightLimit);
}

function renderProjects() {
  if (!projectList) {
    return;
  }

  projectList.innerHTML = "";
  if (projectCount) {
    projectCount.textContent =
      projects.length > 0 ? `${projects.length} persisted project${projects.length === 1 ? "" : "s"}` : "No persisted projects found.";
  }

  if (projects.length === 0) {
    projectList.appendChild(createEmptyListItem("No projects yet. Start an agentic run to populate history."));
    return;
  }

  projects.forEach((project) => {
    const item = document.createElement("li");
    item.className = "project-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "entity-button";
    button.dataset.active = String(project.id === activeProjectId);

    const title = document.createElement("strong");
    title.textContent = project.name || project.id;

    const meta = document.createElement("span");
    meta.className = "entity-meta";
    meta.textContent = `Updated ${formatDate(project.updatedAt || project.updated_at)}`;

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("click", () => {
      openProject(project.id).catch(() => {
        // surface errors via status text
      });
    });

    item.appendChild(button);
    projectList.appendChild(item);
  });
}

function renderQueueList(listElement, countElement, list, emptyText) {
  if (!listElement) {
    return;
  }

  listElement.innerHTML = "";
  if (countElement) {
    countElement.textContent = `${list.length} run${list.length === 1 ? "" : "s"}`;
  }

  if (list.length === 0) {
    listElement.appendChild(createEmptyListItem(emptyText));
    return;
  }

  list.forEach((run) => {
    listElement.appendChild(
      renderRunButton(run, {
        metaText: queueMeta(run),
        showProject: true
      })
    );
  });
}

function renderProjectRuns() {
  if (!runList) {
    return;
  }

  runList.innerHTML = "";
  runList.classList.remove("timeline-list");

  const project = projects.find((item) => item.id === activeProjectId);
  if (runsTitle) {
    runsTitle.textContent = project ? `${project.name} Timeline` : "Project Run History";
  }
  if (runsMeta) {
    runsMeta.textContent = project
      ? `${runs.length} run${runs.length === 1 ? "" : "s"} stored`
      : "Select a project to inspect all persisted runs.";
  }

  if (!project) {
    if (runsSection) {
      runsSection.style.height = "";
      runsSection.style.maxHeight = "";
    }
    runList.style.height = "";
    runList.style.maxHeight = "";
    runList.appendChild(createEmptyListItem("Choose a project to load its full run history."));
    return;
  }

  if (runs.length === 0) {
    if (runsSection) {
      runsSection.style.height = "";
      runsSection.style.maxHeight = "";
    }
    runList.style.height = "";
    runList.style.maxHeight = "";
    runList.appendChild(createEmptyListItem("This project has no persisted test runs yet."));
    return;
  }

  runList.classList.add("timeline-list");
  const timelineRuns = [...runs].sort((a, b) => {
    const ta = runOrderKey(a);
    const tb = runOrderKey(b);
    return ta - tb;
  });
  timelineRuns.forEach((run, index) => {
    runList.appendChild(renderTimelineRunItem(run, index, project.id));
  });

  const tail = document.createElement("li");
  tail.className = "timeline-tail";
  tail.setAttribute("aria-hidden", "true");
  tail.textContent = "\u2193";
  runList.appendChild(tail);
  bindTimelineHeightLimit();
}

function renderLoopArtifacts(artifacts) {
  const box = document.createElement("div");
  box.className = "loop-artifacts";

  const data = artifacts && typeof artifacts === "object" ? artifacts : {};
  const rows = [
    `Screenshots: ${Array.isArray(data.screenshot_refs) ? data.screenshot_refs.length : 0}`,
    `Console errors: ${Array.isArray(data.console_errors) ? data.console_errors.length : 0}`,
    `Video refs: ${Array.isArray(data.video_chunk_refs) ? data.video_chunk_refs.length : 0}`,
    `Metrics: ${data.structured_metrics ? "available" : "none"}`
  ];
  box.textContent = rows.join(" | ");
  return box;
}

function isInstructionEditable(run) {
  return Boolean(run && run.status === "to_be_approved");
}

function getCurrentInstructionSource(run) {
  if (!run) {
    return "";
  }
  if (isInstructionEditable(run)) {
    return String(detailInstructionsEditor?.value || run.testingInstructions || "");
  }
  return String(run.testingInstructions || "");
}

function setInstructionEditHint(value) {
  if (instructionsEditHint) {
    instructionsEditHint.textContent = value;
  }
}

function resetInstructionDraft() {
  instructionDraftRunId = null;
  instructionDraftValue = "";
  instructionDraftDirty = false;
}

function renderPreviewMeta(run, message = "") {
  if (!previewMeta) {
    return;
  }

  if (!run?.previewPath) {
    previewMeta.textContent = message || "No preview linked.";
    return;
  }

  const label = run.previewTitle ? `${run.previewTitle} | ` : "";
  const type = run.previewType ? `${run.previewType} | ` : "";
  previewMeta.textContent = message || `${label}${type}${run.previewPath}`;
}

function setActionButtonState(run) {
  const approvable = Boolean(run && APPROVABLE_STATUSES.has(run.status));
  const cancellable = Boolean(run && CANCELLABLE_STATUSES.has(run.status));
  const variantable = Boolean(run && run.id);
  const editable = isInstructionEditable(run);

  if (approveRunButton) {
    approveRunButton.disabled = !approvable;
    approveRunButton.classList.toggle("hidden", !approvable);
  }
  if (cancelRunButton) {
    cancelRunButton.disabled = !cancellable;
    cancelRunButton.classList.toggle("hidden", !cancellable);
  }
  if (createVariantRunButton) {
    createVariantRunButton.disabled = !variantable;
    createVariantRunButton.classList.toggle("hidden", !variantable);
  }
  if (saveInstructionsButton) {
    saveInstructionsButton.disabled = !editable;
    saveInstructionsButton.classList.toggle("hidden", !editable);
  }
  if (savePreviewButton) {
    savePreviewButton.disabled = !Boolean(run && run.id);
  }
  if (openPreviewButton) {
    openPreviewButton.disabled = !Boolean(run?.previewPath);
  }
}

function renderRunDetail(run) {
  if (!run) {
    activeRunId = null;
    activeRunDetail = null;
    runDetailSignature = "";
    resetInstructionDraft();
    if (detailEmpty) {
      detailEmpty.classList.remove("hidden");
    }
    if (detailContent) {
      detailContent.classList.add("hidden");
    }
    if (detailTitle) {
      detailTitle.textContent = "Select a test run";
    }
    if (detailStatus) {
      detailStatus.textContent = "-";
      detailStatus.dataset.status = "";
    }
    if (detailExecutionStatus) {
      detailExecutionStatus.textContent = "-";
    }
    if (detailSemanticVerdict) {
      detailSemanticVerdict.textContent = "-";
    }
    if (detailSemanticSummary) {
      detailSemanticSummary.textContent = "-";
    }
    if (videoMeta) {
      videoMeta.textContent = "No video linked.";
    }
    if (detailVideo) {
      detailVideo.dataset.videoReference = "";
      detailVideo.src = "";
    }
    if (previewTitleInput) {
      previewTitleInput.value = "";
    }
    if (previewTypeInput) {
      previewTypeInput.value = "static_html";
    }
    if (previewPathInput) {
      previewPathInput.value = "";
    }
    renderPreviewMeta(null);
    if (instructionsEditWrap) {
      instructionsEditWrap.classList.add("hidden");
    }
    if (detailInstructions) {
      detailInstructions.classList.remove("hidden");
      detailInstructions.textContent = "-";
    }
    if (semanticInterpretationBlock) {
      semanticInterpretationBlock.classList.add("hidden");
    }
    if (semanticSuccessList) {
      semanticSuccessList.innerHTML = "";
    }
    if (semanticFailureList) {
      semanticFailureList.innerHTML = "";
    }
    if (semanticRecommendationsList) {
      semanticRecommendationsList.innerHTML = "";
    }
    setActionButtonState(null);
    return;
  }

  activeRunId = run.id;
  activeRunDetail = run;

  if (detailEmpty) {
    detailEmpty.classList.add("hidden");
  }
  if (detailContent) {
    detailContent.classList.remove("hidden");
  }
  if (detailTitle) {
    detailTitle.textContent = `Run ${getRunDisplayLabel(run)}`;
  }
  if (detailStatus) {
    detailStatus.textContent = getDisplayStatus(run);
    detailStatus.dataset.status = getSemanticVerdict(run) || run.status || "";
  }
  if (detailExecutionStatus) {
    detailExecutionStatus.textContent = run.status || "-";
  }
  if (detailSemanticVerdict) {
    detailSemanticVerdict.textContent = formatSemanticVerdict(run);
  }
  if (detailRunId) {
    detailRunId.textContent = `${getRunDisplayLabel(run)} | ${abbreviateRunId(run.id)}`;
    detailRunId.title = run.id || "";
  }
  if (detailProjectName) {
    detailProjectName.textContent = run.projectName || run.projectId || "-";
  }
  if (detailCreated) {
    detailCreated.textContent = formatDate(run.createdAt);
  }
  if (detailUpdated) {
    detailUpdated.textContent = formatDate(run.updatedAt);
  }
  if (detailApprovalRequested) {
    detailApprovalRequested.textContent = formatDate(run.approvalRequestedAt);
  }
  if (detailApproved) {
    const approvedText = run.approvedAt
      ? `${formatDate(run.approvedAt)}${run.approvedBy ? ` by ${run.approvedBy}` : ""}`
      : "-";
    detailApproved.textContent = approvedText;
  }
  if (detailExecutionTime) {
    detailExecutionTime.textContent = formatDuration(run.executionTimeMs);
  }
  if (detailLoopCount) {
    detailLoopCount.textContent = `${run.loopCount || 0} / ${MAX_LOOP_DISPLAY}`;
  }
  if (previewTitleInput) {
    previewTitleInput.value = run.previewTitle || "";
  }
  if (previewTypeInput) {
    previewTypeInput.value = run.previewType || "static_html";
  }
  if (previewPathInput) {
    previewPathInput.value = run.previewPath || "";
  }
  renderPreviewMeta(run);
  const editableInstructions = isInstructionEditable(run);
  const persistedInstructions = run.testingInstructions || "";
  if (editableInstructions) {
    if (instructionDraftRunId !== run.id) {
      instructionDraftRunId = run.id;
      instructionDraftValue = persistedInstructions;
      instructionDraftDirty = false;
    } else if (!instructionDraftDirty) {
      instructionDraftValue = persistedInstructions;
    }

    if (instructionsEditWrap) {
      instructionsEditWrap.classList.remove("hidden");
    }
    if (detailInstructionsEditor && detailInstructionsEditor.value !== instructionDraftValue) {
      detailInstructionsEditor.value = instructionDraftValue;
    }
    if (detailInstructions) {
      detailInstructions.classList.add("hidden");
    }
    setInstructionEditHint("Edits are persisted before approval.");
  } else {
    resetInstructionDraft();
    if (instructionsEditWrap) {
      instructionsEditWrap.classList.add("hidden");
    }
    if (detailInstructions) {
      detailInstructions.classList.remove("hidden");
      detailInstructions.textContent = persistedInstructions || "No testing instructions stored.";
    }
  }
  if (detailDraftPayload) {
    detailDraftPayload.textContent = run.draftPayload ? JSON.stringify(run.draftPayload, null, 2) : "No draft payload stored.";
  }

  if (detailSummary) {
    detailSummary.innerHTML = "";
    normalizeSummary(run.threePointSummary).forEach((point) => {
      const item = document.createElement("li");
      item.textContent = compactText(point, 220) || "No summary recorded.";
      detailSummary.appendChild(item);
    });
  }

  const lastError = run.lastErrorText || "";
  const semanticInterpretation = getSemanticInterpretation(run);
  if (detailSemanticSummary) {
    detailSemanticSummary.textContent = semanticInterpretation?.summary || "No semantic assessment stored.";
  }
  if (errorBlock) {
    errorBlock.classList.toggle("hidden", !lastError || run.status === "completed");
  }
  if (detailError) {
    const readable = formatReadableFailure(lastError, normalizeSummary(run.threePointSummary)[0]);
    const hint = buildFailureFixHint(lastError);
    detailError.textContent = readable ? `${readable}\n\n${hint}` : "-";
    detailError.title = sanitizeErrorText(lastError || "");
  }
  const successfulItems = Array.isArray(semanticInterpretation?.successfulItems) ? semanticInterpretation.successfulItems : [];
  const failedItems = Array.isArray(semanticInterpretation?.failedItems) ? semanticInterpretation.failedItems : [];
  const recommendations = Array.isArray(semanticInterpretation?.recommendations) ? semanticInterpretation.recommendations : [];
  if (semanticInterpretationBlock) {
    semanticInterpretationBlock.classList.toggle(
      "hidden",
      successfulItems.length === 0 && failedItems.length === 0 && recommendations.length === 0 && !semanticInterpretation?.summary
    );
  }
  const populateSemanticList = (element, entries, emptyText) => {
    if (!element) {
      return;
    }
    element.innerHTML = "";
    if (entries.length === 0) {
      const item = document.createElement("li");
      item.textContent = emptyText;
      element.appendChild(item);
      return;
    }
    entries.forEach((point) => {
      const item = document.createElement("li");
      item.textContent = compactText(point, 320) || emptyText;
      element.appendChild(item);
    });
  };
  populateSemanticList(semanticSuccessList, successfulItems, "No successful UX items recorded.");
  populateSemanticList(semanticFailureList, failedItems, "No failing UX items recorded.");
  populateSemanticList(semanticRecommendationsList, recommendations, "No recommendations recorded.");

  if (loopList) {
    loopList.innerHTML = "";
    const loops = Array.isArray(run.loopIterations) ? run.loopIterations : [];
    if (loops.length === 0) {
      loopList.appendChild(createEmptyListItem("No loop iterations stored for this run."));
    } else {
      loops.forEach((loop) => {
        const item = document.createElement("li");
        item.className = "loop-item";

        const topRow = document.createElement("div");
        topRow.className = "run-card-top";

        const title = document.createElement("strong");
        title.textContent = `Loop ${loop.loopNumber}`;

        const chip = document.createElement("span");
        chip.className = "status-chip";
        chip.dataset.status = loop.status || "running";
        chip.textContent = loop.status || "running";

        topRow.appendChild(title);
        topRow.appendChild(chip);

        const summary = document.createElement("div");
        summary.className = "run-summary";
        summary.textContent = loop.stepSummary || "No loop summary stored.";

        const meta = document.createElement("div");
        meta.className = "entity-meta";
        meta.textContent = `Updated ${formatDate(loop.updatedAt)}`;

        item.appendChild(topRow);
        item.appendChild(summary);
        item.appendChild(meta);
        item.appendChild(renderLoopArtifacts(loop.artifacts));
        loopList.appendChild(item);
      });
    }
  }

  if (videoMeta) {
    const resolvedVideoReference = resolveRunVideoReference(run);
    videoMeta.textContent = resolvedVideoReference || "No video linked.";
  }
  if (detailVideo) {
    const nextReference = resolveRunVideoReference(run);
    if ((detailVideo.dataset.videoReference || "") !== nextReference) {
      detailVideo.dataset.videoReference = nextReference;
      detailVideo.src = nextReference ? toLocalFileUrl(nextReference) : "";
      detailVideo.load();
    }
  }

  setActionButtonState(run);
  bindTimelineHeightLimit();
}

async function savePreviewMetadata() {
  if (!window.agenticApi || !activeRunDetail?.id) {
    return;
  }

  setStatus("Saving preview metadata");
  const updated = await window.agenticApi.updateRunPreview({
    runId: activeRunDetail.id,
    previewPath: previewPathInput?.value || "",
    previewTitle: previewTitleInput?.value || "",
    previewType: previewTypeInput?.value || "static_html"
  });
  if (updated) {
    runDetailSignature = "";
    renderRunDetail(updated);
    await loadHistory({ preserveSelection: true, quiet: true });
    setStatus("Preview metadata saved");
    return;
  }
  setStatus("Preview metadata save failed");
}

async function openPreview() {
  if (!window.agenticApi || !activeRunDetail?.previewPath) {
    return;
  }

  setStatus("Opening preview");
  const result = await window.agenticApi.openRunPreview({
    previewPath: activeRunDetail.previewPath
  });
  if (result?.ok) {
    renderPreviewMeta(activeRunDetail, `Opened preview: ${activeRunDetail.previewPath}`);
    setStatus("Preview opened");
    return;
  }
  renderPreviewMeta(activeRunDetail, result?.error || "Failed to open preview.");
  setStatus("Preview open failed");
}

function renderQueues() {
  renderQueueList(approvalList, approvalCount, approvalRuns, "No runs are waiting for approval.");
  renderQueueList(inProgressList, progressCount, inProgressRuns, "No runs are currently in progress.");
}

async function openRun(runId, projectId = null, options = {}) {
  if (!window.agenticApi || !runId) {
    return;
  }

  const silent = options.silent === true;
  const skipListRenders = options.skipListRenders === true;
  const previousActiveRunId = activeRunId;

  if (projectId && projectId !== activeProjectId) {
    activeProjectId = projectId;
    renderProjects();
  }

  if (!silent) {
    setStatus("Loading run detail");
  }

  const detail = await window.agenticApi.getProjectTestRun(runId);
  if (detail?.projectId) {
    activeProjectId = detail.projectId;
  }

  const nextDetailSignature = buildRunDetailSignature(detail);
  const runSelectionChanged = previousActiveRunId !== (detail?.id || null);
  const detailChanged = nextDetailSignature !== runDetailSignature;

  if (!skipListRenders && runSelectionChanged) {
    renderProjects();
    renderProjectRuns();
    renderQueues();
  }

  if (detailChanged || runSelectionChanged) {
    runDetailSignature = nextDetailSignature;
    renderRunDetail(detail);
  }

  if (!silent) {
    setStatus("Approval queues ready");
  }
}

async function openProject(projectId, preferredRunId = null, options = {}) {
  if (!window.agenticApi || !projectId) {
    return;
  }

  const silent = options.silent === true;
  const projectChanged = activeProjectId !== projectId;
  activeProjectId = projectId;

  if (projectChanged) {
    activeRunId = null;
    runDetailSignature = "";
    renderProjects();
    renderRunDetail(null);
  }

  if (!silent) {
    setStatus("Loading project runs");
  }

  const nextRuns = await window.agenticApi.listProjectTestRuns(projectId);
  const nextRunsSignature = buildRunsSignature(nextRuns);
  runs = nextRuns;
  runVersionMap = computeRunVersionMap(runs);

  const runToOpen = preferredRunId && runs.some((run) => run.id === preferredRunId) ? preferredRunId : runs[0]?.id || null;
  const runSelectionChanged = activeRunId !== runToOpen;
  activeRunId = runToOpen;

  if (nextRunsSignature !== runsSignature || projectChanged || runSelectionChanged) {
    runsSignature = nextRunsSignature;
    renderProjectRuns();
  }

  if (runToOpen) {
    await openRun(runToOpen, projectId, { silent, skipListRenders: true });
  } else {
    runVersionMap = computeRunVersionMap([]);
    renderRunDetail(null);
    if (!silent) {
      setStatus("Approval queues ready");
    }
  }
}

async function loadHistory(options = {}) {
  if (!window.agenticApi) {
    setStatus("Agentic history bridge missing");
    return;
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  const preserveSelection = options.preserveSelection !== false;
  const quiet = options.quiet === true;

  loadingPromise = (async () => {
    if (!quiet) {
      setStatus("Loading approval queues");
    }

    const [nextProjects, nextApprovalRuns, nextInProgressRuns] = await Promise.all([
      window.agenticApi.listProjects(),
      window.agenticApi.listAwaitingApprovalRuns(),
      window.agenticApi.listInProgressRuns()
    ]);

    const filteredInProgressRuns = nextInProgressRuns.filter((run) => ACTIVE_QUEUE_STATUSES.has(run.status));
    const nextProjectsSignature = buildProjectsSignature(nextProjects);
    const nextApprovalRunsSignature = buildQueueSignature(nextApprovalRuns);
    const nextInProgressRunsSignature = buildQueueSignature(filteredInProgressRuns);

    projects = nextProjects;
    approvalRuns = nextApprovalRuns;
    inProgressRuns = filteredInProgressRuns;

    if (nextProjectsSignature !== projectsSignature) {
      projectsSignature = nextProjectsSignature;
      renderProjects();
    }
    if (nextApprovalRunsSignature !== approvalRunsSignature) {
      approvalRunsSignature = nextApprovalRunsSignature;
      renderQueueList(approvalList, approvalCount, approvalRuns, "No runs are waiting for approval.");
    }
    if (nextInProgressRunsSignature !== inProgressRunsSignature) {
      inProgressRunsSignature = nextInProgressRunsSignature;
      renderQueueList(inProgressList, progressCount, inProgressRuns, "No runs are currently in progress.");
    }

    if (projects.length === 0) {
      activeProjectId = null;
      activeRunId = null;
      runs = [];
      runVersionMap = computeRunVersionMap([]);
      runsSignature = "";
      runDetailSignature = "";
      renderProjects();
      renderProjectRuns();
      renderRunDetail(null);
      setStatus("No persisted history yet");
      return;
    }

    const nextProjectId =
      preserveSelection && projects.some((project) => project.id === activeProjectId) ? activeProjectId : projects[0].id;
    await openProject(nextProjectId, preserveSelection ? activeRunId : null, { silent: quiet });

    if (!quiet) {
      setStatus("Approval queues ready");
    }
  })()
    .catch((error) => {
      setStatus(`History failed: ${error.message}`);
      throw error;
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

function scheduleHistoryRefresh(options = {}) {
  if (refreshDebounceHandle) {
    clearTimeout(refreshDebounceHandle);
    refreshDebounceHandle = null;
  }
  refreshDebounceHandle = setTimeout(() => {
    refreshDebounceHandle = null;
    loadHistory({
      preserveSelection: options.preserveSelection !== false,
      quiet: options.quiet !== false
    }).catch(() => {
      // surface errors via status text only
    });
  }, EVENT_REFRESH_DEBOUNCE_MS);
}

refreshProjectsButton?.addEventListener("click", async () => {
  await loadHistory();
});

detailInstructionsEditor?.addEventListener("input", () => {
  if (!activeRunDetail || !isInstructionEditable(activeRunDetail)) {
    return;
  }
  instructionDraftRunId = activeRunDetail.id;
  instructionDraftValue = detailInstructionsEditor.value;
  instructionDraftDirty = true;
  setInstructionEditHint("Unsaved edits. Save or approve to persist changes.");
});

saveInstructionsButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !activeRunId || !activeRunDetail || !isInstructionEditable(activeRunDetail)) {
    return;
  }

  const nextInstructions = String(detailInstructionsEditor?.value || "");
  setStatus("Saving instructions");
  await window.agenticApi.updateRunTestingInstructions({
    runId: activeRunId,
    testingInstructions: nextInstructions,
    editedBy: "ui"
  });
  instructionDraftRunId = activeRunId;
  instructionDraftValue = nextInstructions;
  instructionDraftDirty = false;
  setInstructionEditHint("Saved. Approval will use these instructions.");
  await loadHistory({ preserveSelection: true, quiet: true });
  setStatus("Approval queues ready");
});

savePreviewButton?.addEventListener("click", async () => {
  await savePreviewMetadata();
});

openPreviewButton?.addEventListener("click", async () => {
  await openPreview();
});

createVariantRunButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !activeRunId || !activeRunDetail) {
    return;
  }

  setStatus("Creating variant run");
  const createdRun = await window.agenticApi.createVariantRun({
    sourceRunId: activeRunId,
    testingInstructions: getCurrentInstructionSource(activeRunDetail)
  });
  await loadHistory({ preserveSelection: true, quiet: true });
  if (createdRun?.projectId && createdRun?.id) {
    await openProject(createdRun.projectId, createdRun.id, { silent: true });
  }
  setStatus("Approval queues ready");
});

approveRunButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !activeRunId) {
    return;
  }
  setStatus("Approving run");
  const nextInstructions =
    activeRunDetail && isInstructionEditable(activeRunDetail)
      ? String(detailInstructionsEditor?.value || "")
      : undefined;
  await window.agenticApi.approveRun({
    runId: activeRunId,
    approvedBy: "ui",
    testingInstructions: nextInstructions
  });
  instructionDraftDirty = false;
  await loadHistory();
});

cancelRunButton?.addEventListener("click", async () => {
  if (!window.agenticApi || !activeRunId) {
    return;
  }
  setStatus("Cancelling run");
  await window.agenticApi.cancelRun({
    runId: activeRunId,
    reason: "Cancelled from the approval queue UI."
  });
  await loadHistory();
});

if (versionText && window.appInfo) {
  versionText.textContent = `${window.appInfo.name} v${window.appInfo.version}`;
}

if (window.agenticApi && typeof window.agenticApi.onEvent === "function") {
  removeAgenticEventListener = window.agenticApi.onEvent(() => {
    scheduleHistoryRefresh({ quiet: true, preserveSelection: true });
  });
}

if (window.agenticApi && typeof window.agenticApi.onHistoryChanged === "function") {
  removeAgenticHistoryListener = window.agenticApi.onHistoryChanged(() => {
    scheduleHistoryRefresh({ quiet: true, preserveSelection: true });
  });
}

window.addEventListener("resize", () => {
  syncTimelineHeightLimit();
});

window.addEventListener("beforeunload", () => {
  if (timelineLimitObserver) {
    timelineLimitObserver.disconnect();
    timelineLimitObserver = null;
  }
  if (refreshDebounceHandle) {
    clearTimeout(refreshDebounceHandle);
    refreshDebounceHandle = null;
  }
  if (typeof removeAgenticEventListener === "function") {
    removeAgenticEventListener();
    removeAgenticEventListener = null;
  }
  if (typeof removeAgenticHistoryListener === "function") {
    removeAgenticHistoryListener();
    removeAgenticHistoryListener = null;
  }
});

loadHistory().catch(() => {
  // initial load error is already reflected in session status
});

