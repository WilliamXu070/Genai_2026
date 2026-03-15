const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium, _electron: electron } = require("playwright");
const { analyzeRunSemantics } = require("./semantics");
const { RunCriticAgent } = require("./critic_agent");
const { AgenticMySqlPersistenceService, ensureSummaryArray } = require("./agentic_mysql_persistence");
const { ensureExecutionEnvironment, planExecutionEnvironment } = require("./environment_planner");
const { normalizeRuntimeRoots } = require("./runtime_paths");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_AGENTIC_LOOPS = 5;

function parseDotEnv(projectRoot) {
  const out = {};
  const envPaths = [path.join(projectRoot, ".env")];
  const storageRoot = process.env.JUNGLE_STORAGE_ROOT || "";
  if (storageRoot) {
    envPaths.push(path.join(storageRoot, ".env"));
  }

  envPaths.forEach((envPath) => {
    if (!fs.existsSync(envPath)) {
      return;
    }
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx < 0) continue;
      out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, "");
    }
  });

  return out;
}
function buildThreePointSummary(run) {
  const points = [];
  if (run?.summary) {
    points.push(String(run.summary));
  }

  const topIssues = Array.isArray(run?.critique?.issues)
    ? run.critique.issues
    : Array.isArray(run?.critique?.defects)
      ? run.critique.defects
      : [];
  topIssues.slice(0, 2).forEach((issue) => {
    if (issue?.description) {
      points.push(String(issue.description));
    }
  });

  if (points.length < 3 && run?.semantics?.verdict) {
    points.push(`Semantic verdict: ${run.semantics.verdict}`);
  }

  return ensureSummaryArray(points);
}

function buildLoopArtifacts(run) {
  const rawArtifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const asTypePath = rawArtifacts.map((artifact) => ({
    type: artifact?.type || "artifact",
    path: artifact?.path || ""
  }));

  const screenshotRefs = asTypePath.filter((a) => a.path.endsWith(".png")).map((a) => a.path);
  const videoChunkRefs = asTypePath.filter((a) => a.path.endsWith(".webm")).map((a) => a.path);
  if (run?.videoPath && !videoChunkRefs.includes(run.videoPath)) {
    videoChunkRefs.unshift(run.videoPath);
  }
  const criticOutput = run?.critique || null;

  const structuredMetrics = {
    semantics: run?.semantics || null,
    critiqueSeverity: Number(run?.critique?.overall_severity || run?.critique?.readinessScore || 0)
  };
  if (run?.status !== "pass") {
    structuredMetrics.failureInterpretation = deriveFailureInterpretation({
      run,
      objective: "",
      procedure: null,
      testingInstructions: "",
      lastErrorText: run?.summary || "",
      status: "failed"
    });
  }

  return {
    screenshot_refs: screenshotRefs,
    console_errors: [],
    video_chunk_refs: videoChunkRefs,
    critic_output: criticOutput,
    structured_metrics: structuredMetrics,
    artifact_refs: asTypePath
  };
}

function resolveRunVideoPath(runLike, artifactsDir = "") {
  if (runLike?.videoPath) {
    return runLike.videoPath;
  }

  const artifactPaths = Array.isArray(runLike?.artifacts)
    ? runLike.artifacts.map((artifact) => (typeof artifact === "string" ? artifact : artifact?.path || ""))
    : [];
  const artifactVideo = artifactPaths.find((entry) => String(entry || "").toLowerCase().endsWith(".webm"));
  if (artifactVideo) {
    return artifactVideo;
  }

  if (artifactsDir && fs.existsSync(artifactsDir)) {
    const diskVideo = fs
      .readdirSync(artifactsDir)
      .filter((name) => name.toLowerCase().endsWith(".webm"))
      .map((name) => path.join(artifactsDir, name))[0];
    if (diskVideo) {
      return diskVideo;
    }
  }

  return null;
}

const APPROVAL_POLL_INTERVAL_MS = 3000;

function buildApprovalSummary(procedure, targetUrl) {
  const steps = Array.isArray(procedure?.steps) ? procedure.steps : [];
  return ensureSummaryArray([
    "Draft ready and awaiting approval.",
    steps.length > 0 ? `Planned ${steps.length} step(s) for ${targetUrl || "the requested target"}.` : "Planner did not produce executable steps.",
    "Execution will begin only after approval."
  ]);
}

function buildFailureSummary(message) {
  return ensureSummaryArray([
    `Run failed: ${message || "unknown error"}`,
    "Execution did not complete successfully.",
    "Review the stored error message and loop artifacts for details."
  ]);
}

function sanitizeInterpretationText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactInterpretationText(value, maxLength = 200) {
  const text = sanitizeInterpretationText(value);
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function normalizeFeatureArea(objective, procedure, testingInstructions) {
  const candidate =
    objective ||
    procedure?.summary ||
    readTestingInstructionField(testingInstructions, "Objective") ||
    "Validate critical user flow";
  return compactInterpretationText(candidate, 140) || "Validate critical user flow";
}

function collectFailedStepNotes(run) {
  const failedSteps = Array.isArray(run?.steps)
    ? run.steps.filter((step) => String(step?.status || "").toLowerCase() === "fail")
    : [];
  const notes = failedSteps
    .map((step) => compactInterpretationText(step?.note || step?.summary || "", 180))
    .filter(Boolean);
  const semanticNotes = Array.isArray(run?.semantics?.wrong)
    ? run.semantics.wrong
        .filter((entry) => /^failed_step_note:/i.test(String(entry || "")))
        .map((entry) => compactInterpretationText(String(entry).replace(/^failed_step_note:\s*/i, ""), 180))
        .filter(Boolean)
    : [];
  return [...new Set(notes.concat(semanticNotes))];
}

function toSemanticFailureBullets(wrongChecks) {
  return wrongChecks
    .slice(0, 2)
    .map((entry) => String(entry || ""))
    .map((entry) => {
      const [rawKey, ...detailParts] = entry.split(":");
      const key = sanitizeInterpretationText(rawKey).replace(/_/g, " ");
      const detail = compactInterpretationText(detailParts.join(":").trim(), 150);
      if (!key) {
        return "";
      }
      if (!detail) {
        return `Semantic mismatch: ${key}.`;
      }
      return `Semantic mismatch: ${key} failed with ${detail}.`;
    })
    .filter(Boolean);
}

function toCritiqueFailureBullets(issues) {
  return issues
    .slice(0, 2)
    .map((issue) => {
      const description = compactInterpretationText(issue?.description || "", 150);
      const evidence = compactInterpretationText(issue?.evidence || "", 120);
      const fix = compactInterpretationText(issue?.fix || "", 120);
      if (!description && !fix) {
        return "";
      }
      const parts = [`Development focus: ${description || "Address the failing behavior."}`];
      if (evidence) {
        parts.push(`Evidence: ${evidence}.`);
      }
      if (fix) {
        parts.push(`Suggested fix: ${fix}.`);
      }
      return parts.join(" ");
    })
    .filter(Boolean);
}

function deriveFailureInterpretation({ run, objective, procedure, testingInstructions, lastErrorText, status }) {
  const semanticFailures = Array.isArray(run?.semantics?.wrong)
    ? run.semantics.wrong.map((entry) => sanitizeInterpretationText(entry)).filter(Boolean)
    : [];
  const critiqueIssues = Array.isArray(run?.critique?.issues)
    ? run.critique.issues
    : Array.isArray(run?.critique?.defects)
      ? run.critique.defects
      : [];
  const failedStepNotes = collectFailedStepNotes(run);
  const bullets = [];
  const featureArea = normalizeFeatureArea(objective, procedure, testingInstructions);
  const summaryText = compactInterpretationText(run?.summary || lastErrorText || "", 180);
  const readableLastError = compactInterpretationText(lastErrorText || "", 180);

  if (summaryText) {
    bullets.push(`Feature impact: ${featureArea} failed because ${summaryText}.`);
  } else {
    bullets.push(`Feature impact: ${featureArea} did not complete successfully.`);
  }

  failedStepNotes.slice(0, 1).forEach((note) => {
    bullets.push(`Observed failure point: ${note}.`);
  });

  toSemanticFailureBullets(semanticFailures).forEach((bullet) => bullets.push(bullet));
  toCritiqueFailureBullets(critiqueIssues).forEach((bullet) => bullets.push(bullet));

  if (bullets.length < 3 && readableLastError) {
    bullets.push(`Execution evidence: ${readableLastError}.`);
  }

  if (status === "max_loops_reached") {
    bullets.push("Loop limit reached: the same feature path remained unresolved after the maximum 5 iterations.");
  }

  return {
    source: "feature_failure_interpretation_v1",
    generatedAt: nowIso(),
    status: status || "failed",
    featureArea,
    bullets: [...new Set(bullets.map((entry) => compactInterpretationText(entry, 260)).filter(Boolean))].slice(0, 5),
    evidence: {
      semanticFailures: semanticFailures.slice(0, 6),
      critiqueIssues: critiqueIssues.slice(0, 4).map((issue) => ({
        severity: issue?.severity || "",
        description: sanitizeInterpretationText(issue?.description || ""),
        evidence: sanitizeInterpretationText(issue?.evidence || ""),
        fix: sanitizeInterpretationText(issue?.fix || "")
      })),
      failedStepNotes: failedStepNotes.slice(0, 4),
      lastErrorText: sanitizeInterpretationText(lastErrorText || run?.summary || "")
    }
  };
}

function withFailureInterpretationDraftPayload(existingDraftPayload, failureInterpretation) {
  const base = existingDraftPayload && typeof existingDraftPayload === "object" ? { ...existingDraftPayload } : {};
  return {
    ...base,
    failureInterpretation
  };
}

function normalizeSemanticVerdict(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["strong", "mixed", "poor", "inconclusive"].includes(normalized)) {
    return normalized;
  }
  return "inconclusive";
}

function deriveSemanticVerdictFromCritique(critique) {
  const issues = Array.isArray(critique?.issues) ? critique.issues : [];
  const hasCritical = issues.some((issue) => String(issue?.severity || "").toLowerCase() === "critical");
  const hasHigh = issues.some((issue) => String(issue?.severity || "").toLowerCase() === "high");
  if (hasCritical) {
    return "poor";
  }
  if (hasHigh || issues.length > 0) {
    return "mixed";
  }
  return "strong";
}

function buildDeterministicSemanticInterpretation(input) {
  const critique = input?.critique || {};
  const run = input?.run || {};
  const semantics = run?.semantics || {};
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const successfulItems = Array.isArray(critique?.strengths)
    ? critique.strengths.map((entry) => compactInterpretationText(entry, 180)).filter(Boolean)
    : [];
  const failedItems = [];

  const issues = Array.isArray(critique?.issues) ? critique.issues : [];
  issues.forEach((issue) => {
    const description = compactInterpretationText(issue?.description || "", 180);
    if (description) {
      failedItems.push(description);
    }
  });
  if (failedItems.length === 0 && Array.isArray(semantics?.wrong)) {
    semantics.wrong.slice(0, 3).forEach((entry) => {
      const clean = compactInterpretationText(String(entry).replace(/^[^:]+:\s*/i, ""), 180);
      if (clean) {
        failedItems.push(clean);
      }
    });
  }

  const recommendations = issues
    .map((issue) => compactInterpretationText(issue?.fix || "", 180))
    .filter(Boolean)
    .slice(0, 4);

  if (successfulItems.length === 0 && Array.isArray(semantics?.right)) {
    semantics.right.slice(0, 3).forEach((entry) => {
      const clean = compactInterpretationText(String(entry).replace(/^[^:]+:\s*/i, ""), 180);
      if (clean) {
        successfulItems.push(clean);
      }
    });
  }

  const hasMeaningfulInteraction = steps.some((step) =>
    ["click", "fill", "scrollpage", "capturetext", "assertchanged"].includes(String(step?.action || "").toLowerCase())
  );
  if (!hasMeaningfulInteraction) {
    failedItems.push("The run only captured smoke-level evidence and did not exercise the requested feature interaction path.");
    recommendations.push("Add at least one feature-specific interaction step before relying on the UX verdict.");
  }

  let verdict = deriveSemanticVerdictFromCritique(critique);
  if (!hasMeaningfulInteraction && verdict === "strong") {
    verdict = "inconclusive";
  }

  return {
    source: "deterministic_semantic_interpretation_v1",
    generatedAt: nowIso(),
    verdict,
    summary:
      compactInterpretationText(critique?.summary || run?.summary || "", 200) ||
      "Execution completed, but no semantic summary was produced.",
    successfulItems: [...new Set(successfulItems)].slice(0, 5),
    failedItems: [...new Set(failedItems)].slice(0, 5),
    recommendations: [...new Set(recommendations)].slice(0, 5),
    confidence: typeof critique?.confidence === "number" ? critique.confidence : 0.65
  };
}

async function generateSemanticInterpretationWithGemini(apiKey, payload) {
  if (!apiKey) {
    return buildDeterministicSemanticInterpretation(payload);
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const plannedSteps = Array.isArray(payload?.procedure?.steps)
    ? payload.procedure.steps.map((step, index) => `${index + 1}. ${step?.action || "step"} ${step?.target || ""}`.trim())
    : [];
  const executedSteps = Array.isArray(payload?.run?.steps)
    ? payload.run.steps.map((step, index) =>
      `${index + 1}. ${step?.action || "step"} ${step?.target || ""} => status=${step?.status || "unknown"}${step?.note ? ` note=${step.note}` : ""}`.trim()
    )
    : [];
  const prompt = [
    "Interpret this completed UI/UX test run for product development.",
    "Return strict JSON only with keys: verdict, summary, successfulItems(array), failedItems(array), recommendations(array), confidence(number), source.",
    "Do not judge whether the automated test itself succeeded or failed.",
    "Assume the execution completed and focus on what the observed UI/UX behavior did well and poorly.",
    "Use verdict values only: strong, mixed, poor, inconclusive.",
    "Only report failures that are grounded in the requested objective, planned steps, assertions, or observed execution.",
    "If the requested feature was not actually exercised, mark the result inconclusive instead of inventing a failure.",
    "",
    `Objective: ${payload?.objective || ""}`,
    `Procedure Summary: ${payload?.procedure?.summary || ""}`,
    `Loop Count: ${Number(payload?.loopCount || 0)}`,
    `Planned Steps:\n${plannedSteps.join("\n") || "none recorded"}`,
    `Observed Execution Steps:\n${executedSteps.join("\n") || "none recorded"}`,
    "",
    "Run:",
    JSON.stringify(payload?.run || {}, null, 2),
    "",
    "Critique:",
    JSON.stringify(payload?.critique || {}, null, 2),
    "",
    "Deterministic Baseline:",
    JSON.stringify(buildDeterministicSemanticInterpretation(payload), null, 2)
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );
    if (!response.ok) {
      return buildDeterministicSemanticInterpretation(payload);
    }
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const body = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text;
    const parsed = JSON.parse(String(body || "").trim());
    return {
      source: parsed?.source || "gemini_semantic_interpretation_v1",
      generatedAt: nowIso(),
      verdict: normalizeSemanticVerdict(parsed?.verdict),
      summary:
        compactInterpretationText(parsed?.summary || "", 200) ||
        buildDeterministicSemanticInterpretation(payload).summary,
      successfulItems: Array.isArray(parsed?.successfulItems)
        ? parsed.successfulItems.map((entry) => compactInterpretationText(entry, 180)).filter(Boolean).slice(0, 5)
        : buildDeterministicSemanticInterpretation(payload).successfulItems,
      failedItems: Array.isArray(parsed?.failedItems)
        ? parsed.failedItems.map((entry) => compactInterpretationText(entry, 180)).filter(Boolean).slice(0, 5)
        : buildDeterministicSemanticInterpretation(payload).failedItems,
      recommendations: Array.isArray(parsed?.recommendations)
        ? parsed.recommendations.map((entry) => compactInterpretationText(entry, 180)).filter(Boolean).slice(0, 5)
        : buildDeterministicSemanticInterpretation(payload).recommendations,
      confidence: typeof parsed?.confidence === "number"
        ? parsed.confidence
        : buildDeterministicSemanticInterpretation(payload).confidence
    };
  } catch (_) {
    return buildDeterministicSemanticInterpretation(payload);
  }
}

function buildSemanticSummary(semanticInterpretation, fallbackSummary = "") {
  const interpretation = semanticInterpretation && typeof semanticInterpretation === "object" ? semanticInterpretation : null;
  return ensureSummaryArray([
    interpretation?.summary || fallbackSummary || "Execution completed for semantic review.",
    interpretation?.successfulItems?.[0] ? `Worked: ${interpretation.successfulItems[0]}` : "Worked: no positive UX signal recorded.",
    interpretation?.failedItems?.[0] ? `Needs work: ${interpretation.failedItems[0]}` : "Needs work: no blocking UX issue recorded."
  ]);
}

function buildCancelledSummary(reason) {
  return ensureSummaryArray([
    "Run cancelled before completion.",
    reason || "Execution stopped by user request.",
    "No further loops were executed."
  ]);
}

function formatProcedureSteps(procedure) {
  const steps = Array.isArray(procedure?.steps) ? procedure.steps : [];
  if (steps.length === 0) {
    return "No planned steps recorded.";
  }

  return steps
    .map((step, index) => {
      const value = step?.value !== undefined && step?.value !== null ? ` ${String(step.value)}` : "";
      return `${index + 1}. ${step?.action || "step"} ${step?.target || ""}${value}`.trim();
    })
    .join("\n");
}

function buildTargetLabel(input) {
  if (input?.targetType === "electron_app") {
    return `Electron app at ${input?.projectName || "the current project"}`;
  }
  return input?.url || "-";
}

function buildTestingInstructions(objective, input, procedure) {
  const requiredBugChecks = buildRequiredPortfolioBugChecks(
    objective,
    input?.notes || "",
    input?.projectName || ""
  );
  const sections = [
    [`Objective: ${objective}`],
    [`Target Type: ${input?.targetType || "web_frontend"}`],
    [`Target: ${buildTargetLabel(input)}`],
    input?.notes ? [`Notes: ${input.notes}`] : [],
    requiredBugChecks ? [requiredBugChecks] : [],
    input?.additions ? [`Additions: ${input.additions}`] : [],
    procedure?.summary ? [`Draft Summary: ${procedure.summary}`] : [],
    ["Planned Steps:", formatProcedureSteps(procedure)]
  ];

  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}

const PERSONAL_PORTFOLIO_BUG_CHECKS = [
  "Theme toggle - clicks but doesn't actually switch themes",
  "Skills filter - tabs don't filter badges anymore",
  "Contact form - skips validation, always \"sends\" without errors",
  "Smooth scroll - nav links don't scroll to sections"
];

function shouldEnforcePortfolioBugChecks(objective, notes = "", projectName = "") {
  const corpus = `${String(objective || "")}\n${String(notes || "")}\n${String(projectName || "")}`.toLowerCase();
  const hasPortfolioSignal = /personal portfolio|portfolio ui\/ux|portfolio/.test(corpus);
  return hasPortfolioSignal;
}

function buildRequiredPortfolioBugChecks(objective, notes = "", projectName = "") {
  if (!shouldEnforcePortfolioBugChecks(objective, notes, projectName)) {
    return "";
  }
  const checklist = PERSONAL_PORTFOLIO_BUG_CHECKS.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return `Required Bug Checks:\n${checklist}`;
}

function appendRequiredPortfolioBugChecks(objective, notes = "", projectName = "") {
  const required = buildRequiredPortfolioBugChecks(objective, notes, projectName);
  if (!required) {
    return String(notes || "");
  }
  const base = String(notes || "").trim();
  if (base.toLowerCase().includes("required bug checks")) {
    return base;
  }
  return [base, required].filter(Boolean).join("\n\n");
}

function buildApprovedExecutionNotes(draftPayload, testingInstructions) {
  const sections = [];
  if (draftPayload?.notes) {
    sections.push(String(draftPayload.notes));
  }
  if (testingInstructions) {
    sections.push(["Approved testing instructions:", String(testingInstructions)].join("\n"));
  }
  return sections.filter(Boolean).join("\n\n");
}

function readTestingInstructionField(testingInstructions, label) {
  const match = String(testingInstructions || "").match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim() || "";
}

function readTestingInstructionTarget(testingInstructions) {
  return (
    readTestingInstructionField(testingInstructions, "Target") ||
    readTestingInstructionField(testingInstructions, "Target URL")
  );
}

function buildPersistentRunSeed(run, overrides = {}) {
  const payload = run?.draftPayload && typeof run.draftPayload === "object" ? run.draftPayload : {};
  const testingInstructions = typeof overrides.testingInstructions === "string"
    ? overrides.testingInstructions
    : run?.testingInstructions || "";

  const objective =
    overrides.objective ||
    payload.objective ||
    readTestingInstructionField(testingInstructions, "Objective") ||
    "Validate critical user flow";
  const targetType =
    overrides.targetType ||
    payload.targetType ||
    readTestingInstructionField(testingInstructions, "Target Type") ||
    "web_frontend";
  const url =
    overrides.url ||
    payload.url ||
    (targetType === "web_frontend" ? readTestingInstructionTarget(testingInstructions) : "") ||
    (targetType === "web_frontend" ? "http://127.0.0.1:3000" : "");
  const projectName = overrides.projectName || payload.projectName || run?.projectName || "Jungle";
  const notes = [
    payload.notes || "",
    overrides.notes || ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    actionDelayMs: payload.actionDelayMs ?? null,
    additions: payload.additions || "",
    codexTimeoutMs: payload.codexTimeoutMs || null,
    maxAttempts: payload.maxAttempts || MAX_AGENTIC_LOOPS,
    notes,
    objective,
    projectName,
    skipCodex: Boolean(payload.skipCodex),
    targetType,
    testingInstructions,
    url
  };
}

function buildRetryNotes(baseNotes, lastRun) {
  const sections = [baseNotes || ""];
  sections.push(
    "Retry guidance: keep the approved feature scope. Repair only the failing selector or assertion. Do not replace the scenario with a generic smoke test."
  );
  sections.push(
    "Retry guidance: use canonical actions only (goto, click, fill, assertVisible, assertText, captureText, assertChanged, assertNotVisible, screenshot, scrollPage, wait)."
  );
  sections.push(
    "Retry guidance: for counters or totals, prefer captureText plus assertChanged over guessed numeric values, and reuse the exact visible UI copy for status/button assertions."
  );

  if (lastRun?.summary) {
    sections.push(`Previous run summary: ${lastRun.summary}`);
  }

  const failedStepNote = collectFailedStepNotes(lastRun)[0];
  if (failedStepNote) {
    sections.push(`Previous failed step: ${failedStepNote}`);
  }

  return sections.filter(Boolean).join("\n");
}

function buildVariantRunSummary(sourceRunId) {
  return ensureSummaryArray([
    `Variant created from run ${sourceRunId}.`,
    "Edit the copied testing instructions before approval.",
    "Execution will start only after this new run is approved."
  ]);
}

function buildDraftPayload({ input, objective, draft, maxAttempts, attempt = 1 }) {
  const procedure = draft?.tree?.procedure || null;
  return {
    attempt,
    maxAttempts,
    objective,
    projectName: input?.projectName || "Jungle",
    url: input?.url || "",
    notes: input?.notes || "",
    additions: input?.additions || "",
    skipCodex: Boolean(input?.skipCodex),
    codexTimeoutMs: input?.codexTimeoutMs || null,
    actionDelayMs: input?.actionDelayMs ?? null,
    forestId: draft?.forestId || null,
    treeId: draft?.tree?.treeId || null,
    procedure,
    requestParser: draft?.tree?.requestParser || (procedure ? buildRequestParser(procedure) : null),
    targetType: input?.targetType || draft?.tree?.executionProfile?.targetType || "web_frontend"
  };
}

class AgenticStore {
  constructor(storageRoot) {
    this.storageRoot = storageRoot;
    this.dbDir = path.join(storageRoot, "db");
    this.dbPath = path.join(this.dbDir, "agentic.json");
    ensureDir(this.dbDir);
    ensureDir(path.join(this.dbDir, "agentic_artifacts"));

    if (!fs.existsSync(this.dbPath)) {
      this.write({ schemaVersion: "0.1.0", forests: [], runs: [] });
    }
  }

  read() {
    return JSON.parse(fs.readFileSync(this.dbPath, "utf8"));
  }

  write(db) {
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }

  listForests() {
    return this.read().forests;
  }

  getForest(forestId) {
    return this.read().forests.find((f) => f.forestId === forestId) || null;
  }

  createForest(input) {
    const db = this.read();
    const forest = {
      forestId: `forest_${Date.now()}`,
      projectName: input.projectName || "Jungle Project",
      url: input.url,
      objective: input.objective || "Generate and execute generalized Playwright tests",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      trees: []
    };
    db.forests.unshift(forest);
    this.write(db);
    return forest;
  }

  addTree(forestId, treeInput) {
    const db = this.read();
    const forest = db.forests.find((f) => f.forestId === forestId);
    if (!forest) throw new Error("Forest not found");

    const version = (forest.trees[0]?.version || 0) + 1;
    const tree = {
      treeId: `tree_${Date.now()}`,
      version,
      status: "draft",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      procedure: treeInput.procedure,
      requestParser: treeInput.requestParser,
      executionProfile: treeInput.executionProfile || { recordVideo: true },
      lastRunId: null
    };

    forest.trees.unshift(tree);
    forest.updatedAt = nowIso();
    this.write(db);
    return { forest, tree };
  }

  listTrees(forestId) {
    const forest = this.getForest(forestId);
    return forest ? forest.trees : [];
  }

  updateTree(forestId, treeId, updater) {
    const db = this.read();
    const forest = db.forests.find((f) => f.forestId === forestId);
    if (!forest) throw new Error("Forest not found");
    const idx = forest.trees.findIndex((t) => t.treeId === treeId);
    if (idx < 0) throw new Error("Tree not found");
    const next = updater({ ...forest.trees[idx] });
    next.updatedAt = nowIso();
    forest.trees[idx] = next;
    forest.updatedAt = nowIso();
    this.write(db);
    return next;
  }

  addRun(forestId, treeId, runInput) {
    const db = this.read();
    const run = {
      runId: `agentic_run_${Date.now()}`,
      forestId,
      treeId,
      createdAt: nowIso(),
      status: runInput.status,
      steps: runInput.steps,
      artifacts: runInput.artifacts,
      summary: runInput.summary,
      videoPath: runInput.videoPath || null,
      semantics: runInput.semantics || null,
      critique: runInput.critique || null
    };
    db.runs.unshift(run);

    const forest = db.forests.find((f) => f.forestId === forestId);
    const tree = forest?.trees.find((t) => t.treeId === treeId);
    if (tree) {
      tree.lastRunId = run.runId;
      tree.status = run.status === "pass" ? "validated" : "failed";
      tree.updatedAt = nowIso();
    }
    if (forest) forest.updatedAt = nowIso();
    if (forest) {
      const forestRuns = db.runs.filter((r) => r.forestId === forestId);
      forest.summary = this.buildForestSummary(forestRuns);
    }

    this.write(db);
    return run;
  }

  buildForestSummary(forestRuns) {
    const totalRuns = forestRuns.length;
    const passRuns = forestRuns.filter((r) => r.status === "pass").length;
    const failRuns = totalRuns - passRuns;
    const issueCounts = new Map();

    forestRuns.forEach((run) => {
      (run.critique?.issues || []).forEach((issue) => {
        const key = issue.id || "unknown_issue";
        issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
      });
    });

    const recurringIssues = Array.from(issueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count }));

    const avgReadiness =
      totalRuns > 0
        ? forestRuns.reduce((sum, run) => sum + Number(run.critique?.readinessScore || (run.status === "pass" ? 100 : 0)), 0) /
          totalRuns
        : 0;

    return {
      totalRuns,
      passRuns,
      failRuns,
      passRate: totalRuns > 0 ? Number(((passRuns / totalRuns) * 100).toFixed(2)) : 0,
      avgReadiness: Number(avgReadiness.toFixed(2)),
      latestRunId: forestRuns[0]?.runId || null,
      latestStatus: forestRuns[0]?.status || null,
      recurringIssues,
      updatedAt: nowIso()
    };
  }

  listRuns(forestId) {
    const runs = this.read().runs;
    return forestId ? runs.filter((r) => r.forestId === forestId) : runs;
  }
}

async function collectInspectionContext(page) {
  return page.evaluate(() => {
    const takeTexts = (selector, limit = 8) =>
      Array.from(document.querySelectorAll(selector))
        .map((el) => (el.innerText || el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, limit);

    const buttonSelectors = Array.from(document.querySelectorAll("button, [role='button']"))
      .map((el) => {
        if (el.id) return `#${el.id}`;
        const testId = el.getAttribute("data-testid");
        if (testId) return `[data-testid='${testId}']`;
        const text = (el.innerText || el.textContent || "").trim();
        return text ? `text=${text}` : null;
      })
      .filter(Boolean)
      .slice(0, 12);

    const textTargets = Array.from(document.querySelectorAll("[id], [data-testid], .status, .state, p, div, span"))
      .map((el) => {
        if (["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
          return null;
        }
        const id = el.id || "";
        const testId = el.getAttribute("data-testid") || "";
        const selector = id ? `#${id}` : testId ? `[data-testid='${testId}']` : null;
        if (!selector) return null;
        const signal = `${id} ${testId}`.toLowerCase();
        const score = /(state|status|result|output|message|count|step)/.test(signal) ? 2 : 1;
        return { selector, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.selector)
      .slice(0, 12);

    return {
      title: document.title,
      url: location.href,
      headings: takeTexts("h1, h2, h3", 12),
      buttons: takeTexts("button, [role='button']", 12),
      buttonSelectors,
      textTargets,
      links: takeTexts("a", 12),
      hasForms: !!document.querySelector("form"),
      inputs: Array.from(document.querySelectorAll("input, textarea, select"))
        .map((el) => el.getAttribute("name") || el.id || el.getAttribute("placeholder") || el.tagName)
        .slice(0, 10)
    };
  });
}

async function inspectWebFrontend(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const inspection = await collectInspectionContext(page);
    return inspection;
  } finally {
    await browser.close();
  }
}

async function inspectElectronApp(projectRoot) {
  const launchEnv = {
    ...process.env,
    JUNGLE_PROJECT_ROOT: projectRoot,
    ...(process.env.JUNGLE_STORAGE_ROOT ? { JUNGLE_STORAGE_ROOT: process.env.JUNGLE_STORAGE_ROOT } : {})
  };
  const app = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: launchEnv
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const context = await collectInspectionContext(page);
    return {
      ...context,
      electronWindow: true
    };
  } finally {
    await app.close();
  }
}

async function inspectTarget(environmentPlan, input) {
  if (environmentPlan?.playwrightMode === "electron") {
    return inspectElectronApp(input.projectRoot);
  }
  return inspectWebFrontend(input.url || environmentPlan?.launchTarget?.value);
}

function targetLooksVolatile(target) {
  const normalized = String(target || "").trim();
  if (!normalized) {
    return false;
  }
  if (!/^text=/i.test(normalized)) {
    return false;
  }
  return (
    /\bupdated\b/i.test(normalized) ||
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(normalized) ||
    /\b\d{1,2}:\d{2}(?::\d{2})?\s?(AM|PM)\b/i.test(normalized)
  );
}

function hasSupportedInteraction(steps) {
  return steps.some((step) => ["click", "fill", "scrollpage"].includes(String(step?.action || "").toLowerCase()));
}

function shouldFallbackToDeterministicProcedure(procedure, inspection, environmentPlan = null) {
  const parser = buildRequestParser(procedure);
  const hasUnsupportedAction = parser.normalizedSteps.some((step) => !step.action);
  if (hasUnsupportedAction) {
    return true;
  }

  const hasVolatileSelector = (procedure?.steps || []).some((step) => targetLooksVolatile(step?.target));
  if (hasVolatileSelector) {
    return true;
  }

  if (Array.isArray(inspection?.buttonSelectors) && inspection.buttonSelectors.length > 0 && !hasSupportedInteraction(parser.normalizedSteps)) {
    return true;
  }

  if (environmentPlan?.playwrightMode === "electron") {
    const hasNavigationStep = parser.normalizedSteps.some((step) => String(step?.action || "").toLowerCase() === "goto");
    if (hasNavigationStep) {
      return true;
    }
  }

  return false;
}

function fallbackProcedure(inspection, objective, notes, environmentPlan = null) {
  const firstHeading = inspection.headings?.[0] || inspection.title || "main page";
  const objectiveText = `${objective || ""} ${notes || ""}`.toLowerCase();
  const candidateButtons = Array.isArray(inspection.buttonSelectors) ? inspection.buttonSelectors : [];
  const matchedRule = [
    { objective: /(complete|undo|task|board)/i, selector: /(complete|undo|task)/i },
    { objective: /(filter|active|completed|all)/i, selector: /(filter|active|completed|all)/i },
    { objective: /(add|create|form)/i, selector: /(add|create)/i },
    { objective: /(theme|night|daylight)/i, selector: /(theme|night|daylight)/i },
    { objective: /(settings|modal|dialog|close)/i, selector: /(settings|modal|dialog|close)/i }
  ].find((rule) => rule.objective.test(objectiveText));
  const buttonTarget =
    (matchedRule ? candidateButtons.find((selector) => matchedRule.selector.test(selector)) : null) ||
    candidateButtons[0] ||
    null;
  const likelyModalTarget =
    inspection.textTargets?.find((selector) => /modal|dialog|settings/i.test(selector)) || null;
  const hasInteractiveControl = Boolean(buttonTarget);
  const isElectron = environmentPlan?.playwrightMode === "electron";

  let steps;
  if (hasInteractiveControl) {
    steps = [
      ...(isElectron ? [] : [{ action: "goto", target: inspection.url || "/" }]),
      { action: "assertVisible", target: `text=${firstHeading}` },
      { action: "assertVisible", target: buttonTarget }
    ];

    if (isElectron) {
      steps = steps.concat([
        { action: "click", target: buttonTarget },
        { action: "wait", target: "post_click_stabilize", value: 1500 },
        ...(likelyModalTarget ? [{ action: "assertVisible", target: likelyModalTarget }] : []),
        { action: "screenshot", target: "fullPage" }
      ]);
    } else {
      steps = steps.concat([
        { action: "click", target: buttonTarget },
        { action: "wait", target: "post_click_stabilize", value: 1500 },
        ...(likelyModalTarget ? [{ action: "assertVisible", target: likelyModalTarget }] : []),
        { action: "screenshot", target: "fullPage" }
      ]);
    }
  } else {
    steps = [
      ...(isElectron ? [] : [{ action: "goto", target: inspection.url || "/" }]),
      { action: "assertVisible", target: `text=${firstHeading}` },
      { action: "wait", target: "time", value: isElectron ? 1500 : 10000 },
      { action: "scrollPage", target: "down" },
      { action: "screenshot", target: "fullPage" }
    ];
  }

  return {
    summary: `Validate ${firstHeading} flow and core interactions for objective: ${objective}`,
    confirmMessage:
      "Confirm this testing procedure. You can add extra checks before execution (auth, edge cases, copy assertions).",
    steps,
    notes: notes || ""
  };
}

async function generateProcedureWithGemini(apiKey, inspection, objective, notes, environmentPlan = null, projectName = "") {
  if (!apiKey) {
    return fallbackProcedure(inspection, objective, notes, environmentPlan);
  }
  const requiredBugChecks = buildRequiredPortfolioBugChecks(objective, notes, projectName);

const prompt = `Generate a target-specific Playwright testing procedure as strict JSON with keys: summary, confirmMessage, steps(array), notes.
Each step must include: action and target; optional value/assert.
Allowed actions only: goto, click, fill, assertVisible, assertText, captureText, assertChanged, assertNotVisible, screenshot, scrollPage, wait.
Use robust selectors (role/text/ids/data-testid when present) and avoid hardcoded business values.
Never use dynamic timestamps, dates, relative times, or "Updated ..." text as selectors.
If an interactive control exists, include at least one supported interaction step such as click, fill, or scrollPage.
Prefer data-testid selectors over raw text when the inspection context exposes them.
When a feature depends on filtering or removal from a view, prefer assertNotVisible over a vague changed-state assertion.
For counters or totals that may start non-zero, prefer captureText plus assertChanged over hardcoded numeric expectations.
Use the exact visible copy from the inspected UI for status pills and button labels; do not invent synonyms.
If a flow undoes a change, compare against the previously captured baseline instead of guessing new totals.
Keep retries within the same feature scope; do not replace the requested scenario with a generic smoke test.
${requiredBugChecks ? `The following feature checks are mandatory and must each have explicit validation steps:\n${requiredBugChecks}\n` : ""}
Target type: ${environmentPlan?.targetType || "web_frontend"}
Playwright mode: ${environmentPlan?.playwrightMode || "web"}
If target type is electron_app, do not emit browser navigation assumptions unless the app itself exposes an in-window web navigation control.
If target type is electron_app, prefer stable controls like headings, ids, roles, and data-testid values.
Every interactive step must stay feature-specific to the objective and use selectors discovered in the inspection context when possible.
Inspection context:\n${JSON.stringify(inspection, null, 2)}
Objective: ${objective}
Additional notes: ${notes || "none"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    }
  );

  if (!response.ok) {
    return fallbackProcedure(inspection, objective, notes, environmentPlan);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try {
    const body = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text;
    const parsed = JSON.parse(body.trim());
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0 || shouldFallbackToDeterministicProcedure(parsed, inspection, environmentPlan)) {
      return fallbackProcedure(inspection, objective, notes, environmentPlan);
    }
    return parsed;
  } catch (_) {
    return fallbackProcedure(inspection, objective, notes, environmentPlan);
  }
}

async function runCodexMcpStep({ objective, url, inspection, timeoutMs = 120000, cwd }) {
  return new Promise((resolve) => {
    const prompt = [
      "Initiate MCP testing procedure for this project.",
      `Target URL: ${url}`,
      `Objective: ${objective}`,
      "Return strict JSON with keys: parser_plan, selector_strategy, risk_checks, suggested_steps.",
      "Website context:",
      JSON.stringify(inspection)
    ].join("\n");

    const child = spawn("codex", ["exec", prompt], {
      shell: true,
      cwd: cwd || process.cwd(),
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        // ignore
      }
      finish({
        status: "timeout",
        pass: false,
        reason: `codex exec timed out after ${timeoutMs}ms`,
        stdout,
        stderr
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        status: "error",
        pass: false,
        reason: error.message,
        stdout,
        stderr
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        status: code === 0 ? "ok" : "error",
        pass: code === 0,
        reason: code === 0 ? "Codex MCP planning completed" : `codex exited with code ${code}`,
        stdout,
        stderr
      });
    });
  });
}

function buildRequestParser(procedure) {
  const normalizeAction = (action) => {
    const raw = String(action || "").trim();
    const key = raw.toLowerCase();
    if (!key) return null;
    if (
      [
        "goto",
        "click",
        "fill",
        "assertvisible",
        "asserttext",
        "capturetext",
        "assertchanged",
        "assertnotvisible",
        "screenshot",
        "scrollpage",
        "wait"
      ].includes(key)
    ) {
      return key;
    }
    if (key.includes("goto") || key.includes("navigate")) return "goto";
    if (key.includes("click") || key.includes("press")) return "click";
    if (key.includes("fill") || key.includes("type") || key.includes("enter")) return "fill";
    if (key.includes("assert") && (key.includes("notvisible") || key.includes("hidden") || key.includes("not_visible"))) {
      return "assertnotvisible";
    }
    if (key.includes("assert") && key.includes("visible")) return "assertvisible";
    if (key.includes("assert") && (key.includes("text") || key.includes("content"))) return "asserttext";
    if (key.includes("capture") && key.includes("text")) return "capturetext";
    if (key.includes("assert") && key.includes("change")) return "assertchanged";
    if (key.includes("screenshot") || key.includes("screen shot")) return "screenshot";
    if (key.includes("scroll")) return "scrollpage";
    if (key === "wait" || key.includes("wait") || key.includes("delay")) return "wait";
    return null;
  };

  const toRuntimeAction = (normalized) => {
    if (normalized === "assertvisible") return "assertVisible";
    if (normalized === "asserttext") return "assertText";
    if (normalized === "capturetext") return "captureText";
    if (normalized === "assertchanged") return "assertChanged";
    if (normalized === "assertnotvisible") return "assertNotVisible";
    if (normalized === "scrollpage") return "scrollPage";
    return normalized;
  };

  return {
    parserVersion: "0.1.0",
    normalizedSteps: (procedure.steps || []).map((s, i) => ({
      index: i,
      action: toRuntimeAction(normalizeAction(s.action)),
      originalAction: s.action,
      target: s.target,
      value: s.value ?? s.assert ?? null,
      assert: s.assert || null
    }))
  };
}

function getStepDelayMs(step, actionDelayMs = 500) {
  const baseDelay = Math.max(0, Number(actionDelayMs) || 500);
  return Math.max(500, baseDelay);
}

function resolveStepValue(stepValue, stateStore) {
  const raw = String(stepValue ?? "");
  const storedMatch = raw.match(/^\{([^}]+)\}$/);
  if (storedMatch) {
    return String(stateStore?.[storedMatch[1]] ?? "");
  }
  return raw;
}

function stepToCode(step, actionDelayMs = 500, executionPlan = { playwrightMode: "web" }) {
  const target = JSON.stringify(step.target || "body");
  const value = JSON.stringify(step.value || "");
  const delay = getStepDelayMs(step, actionDelayMs);
  const waitMs = 500;
  const isElectron = executionPlan?.playwrightMode === "electron";

  switch (step.action) {
    case "goto":
      return isElectron
        ? `await page.waitForLoadState('domcontentloaded');\n  await page.waitForTimeout(${delay});`
        : `await page.goto(${target}, { waitUntil: 'domcontentloaded' });\n  await page.waitForTimeout(${delay});`;
    case "click":
      return `await page.locator(${target}).first().click();\n  await page.waitForTimeout(${delay});`;
    case "fill":
      return `await page.locator(${target}).first().fill(${value});\n  await page.waitForTimeout(${delay});`;
    case "assertVisible":
      return `const visible = await page.locator(${target}).first().isVisible().catch(() => false);\n  if (!visible) { /* observation mismatch */ }\n  await page.waitForTimeout(${delay});`;
    case "assertText":
      return `const expectedText = ((raw) => { const match = String(raw || '').match(/^\\{([^}]+)\\}$/); return match ? String(stateStore[match[1]] || '') : String(raw || ''); })(${value});\n  const observedText = await page.locator(${target}).first().innerText().catch(() => '');\n  if (!String(observedText || '').includes(expectedText)) { /* observation mismatch */ }\n  await page.waitForTimeout(${delay});`;
    case "captureText":
      return `stateStore[${value}] = await page.locator(${target}).first().innerText();\n  await page.waitForTimeout(${delay});`;
    case "assertChanged":
      return `await page.waitForFunction(({ sel, prev }) => { const el = document.querySelector(sel); return !!el && (el.innerText || el.textContent || '').trim() !== prev; }, { sel: ${target}, prev: (stateStore[${value}] || '') }, { timeout: 5000 });\n  await page.waitForTimeout(${delay});`;
    case "assertNotVisible":
      return `const hidden = !(await page.locator(${target}).first().isVisible().catch(() => false));\n  if (!hidden) { /* observation mismatch */ }\n  await page.waitForTimeout(${delay});`;
    case "screenshot":
      return `await page.screenshot({ path: path.join(artifactsDir, 'step_${Date.now()}.png'), fullPage: true });\n  await page.waitForTimeout(${delay});`;
    case "scrollPage":
      return `await page.evaluate(async () => { const maxY = document.documentElement.scrollHeight - window.innerHeight; let y = 0; const stride = Math.max(64, Math.floor(window.innerHeight * 0.35)); while (y < maxY) { y = Math.min(maxY, y + stride); window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 450)); } });\n  await page.waitForTimeout(${delay});`;
    case "wait":
      return `await page.waitForTimeout(${waitMs});\n  await page.waitForTimeout(${delay});`;
    default:
      return `// TODO unsupported action: ${step.action}`;
  }
}

function generatePlaywrightProgram(parser, actionDelayMs = 500, executionPlan = { playwrightMode: "web" }) {
  const lines = parser.normalizedSteps.map((s) => stepToCode(s, actionDelayMs, executionPlan)).join("\n  ");
  if (executionPlan?.playwrightMode === "electron") {
    return `const path = require('node:path');\nconst fs = require('node:fs');\nconst { _electron: electron, expect } = require('playwright');\n\nasync function run({ projectRoot, artifactsDir }) {\n  const app = await electron.launch({ args: [projectRoot], cwd: projectRoot, recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });\n  const page = await app.firstWindow();\n  const pageVideo = typeof page.video === 'function' ? page.video() : null;\n  const stateStore = {};\n  try {\n    await page.waitForLoadState('domcontentloaded');\n  ${lines}\n  } finally {\n    await page.screenshot({ path: path.join(artifactsDir, 'final_' + Date.now() + '.png'), fullPage: true }).catch(() => {});\n    await app.close();\n    if (pageVideo) {\n      try {\n        await pageVideo.path();\n      } catch (_) {}\n    }\n  }\n}\n\nmodule.exports = { run };\n`;
  }
  return `const path = require('node:path');\nconst fs = require('node:fs');\nconst { chromium, expect } = require('playwright');\n\nasync function run({ baseUrl, artifactsDir }) {\n  const browser = await chromium.launch({ headless: true });\n  const context = await browser.newContext({ recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } } });\n  const page = await context.newPage();\n  const stateStore = {};\n  try {\n  ${lines}\n  } finally {\n    await context.close();\n    await browser.close();\n  }\n}\n\nmodule.exports = { run };\n`;
}

async function executePageSteps(page, parser, artifactsDir, actionDelayMs = 500, executionPlan = { playwrightMode: "web", launchTarget: {} }) {
  const stepResults = [];
  let status = "pass";
  let summary = "Procedure executed successfully.";
  const stateStore = {};
  let failedStepCount = 0;

  for (const step of parser.normalizedSteps) {
    const s = { index: step.index, action: step.action, target: step.target, status: "pass", note: "ok" };
    try {
      const stepDelayMs = getStepDelayMs(step, actionDelayMs);
      if (step.action === "goto") {
        if (executionPlan?.playwrightMode === "electron") {
          await page.waitForLoadState("domcontentloaded");
        } else {
          const baseUrl = executionPlan?.launchTarget?.value;
          const dest = step.target?.startsWith("http") ? step.target : new URL(step.target || "/", baseUrl).toString();
          await page.goto(dest, { waitUntil: "domcontentloaded", timeout: 30000 });
        }
        await sleep(stepDelayMs);
      } else if (step.action === "click") {
        await page.locator(step.target).first().click({ timeout: 10000 });
        await sleep(stepDelayMs);
      } else if (step.action === "fill") {
        await page.locator(step.target).first().fill(step.value || "", { timeout: 10000 });
        await sleep(stepDelayMs);
      } else if (step.action === "assertVisible") {
        const visible = await page.locator(step.target).first().isVisible().catch(() => false);
        if (!visible) {
          s.status = "fail";
          s.note = `Observation mismatch: expected visible for '${step.target}'.`;
          failedStepCount += 1;
        }
        await sleep(stepDelayMs);
      } else if (step.action === "assertText") {
        const expectedText = resolveStepValue(step.value, stateStore);
        const txt = await page.locator(step.target).first().innerText({ timeout: 500 }).catch(() => "");
        if (!txt.includes(expectedText)) {
          s.status = "fail";
          s.note = `Observation mismatch: expected '${expectedText}' in '${step.target}', got '${txt}'.`;
          failedStepCount += 1;
        }
        await sleep(stepDelayMs);
      } else if (step.action === "captureText") {
        stateStore[step.value || `step_${step.index}`] = await page
          .locator(step.target)
          .first()
          .innerText({ timeout: 10000 });
        await sleep(stepDelayMs);
      } else if (step.action === "assertChanged") {
        const key = step.value || `step_${step.index - 1}`;
        const prev = stateStore[key] || "";
        const current = await page
          .locator(step.target)
          .first()
          .innerText({ timeout: 500 })
          .catch(() => "");
        if (String(current || "").trim() === String(prev || "").trim()) {
          s.status = "fail";
          s.note = `Observation mismatch: expected '${step.target}' text to change.`;
          failedStepCount += 1;
        }
        await sleep(stepDelayMs);
      } else if (step.action === "assertNotVisible") {
        const visible = await page.locator(step.target).first().isVisible().catch(() => false);
        if (visible) {
          s.status = "fail";
          s.note = `Observation mismatch: expected hidden for '${step.target}'.`;
          failedStepCount += 1;
        }
        await sleep(stepDelayMs);
      } else if (step.action === "screenshot") {
        await page.screenshot({ path: path.join(artifactsDir, `step_${Date.now()}.png`), fullPage: true });
        await sleep(stepDelayMs);
      } else if (step.action === "scrollPage") {
        await page.evaluate(async () => {
          const maxY = document.documentElement.scrollHeight - window.innerHeight;
          let y = 0;
          const stride = Math.max(64, Math.floor(window.innerHeight * 0.35));
          while (y < maxY) {
            y = Math.min(maxY, y + stride);
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 450));
          }
        });
        await sleep(stepDelayMs);
      } else if (step.action === "wait") {
        await page.waitForTimeout(500);
        await sleep(stepDelayMs);
      } else {
        throw new Error(`Unsupported action '${step.action || step.originalAction || "unknown"}'`);
      }
    } catch (error) {
      s.status = "fail";
      s.note = error.message;
      failedStepCount += 1;
    }

    stepResults.push(s);
  }

  if (failedStepCount > 0) {
    status = "fail";
    summary = `Completed all steps with ${failedStepCount} observation/runtime issue(s).`;
  }

  await page.screenshot({ path: path.join(artifactsDir, `final_${Date.now()}.png`), fullPage: true }).catch(() => {});
  return { status, summary, steps: stepResults };
}

async function executeProcedure(executionPlan, parser, artifactsDir, actionDelayMs = 500) {
  ensureDir(artifactsDir);

  if (executionPlan?.playwrightMode === "electron") {
    const electronProjectRoot = executionPlan.launchTarget.value;
    const electronEnv = {
      ...process.env,
      ...(executionPlan.launchEnv || {}),
      JUNGLE_PROJECT_ROOT: electronProjectRoot
    };
    const app = await electron.launch({
      args: [electronProjectRoot],
      cwd: electronProjectRoot,
      env: electronEnv,
      recordVideo: {
        dir: artifactsDir,
        size: { width: 1280, height: 720 }
      }
    });
    let pageVideo = null;
    let appClosed = false;
    try {
      const page = await app.firstWindow();
      pageVideo = typeof page.video === "function" ? page.video() : null;
      await page.waitForLoadState("domcontentloaded");
      const pageResult = await executePageSteps(page, parser, artifactsDir, actionDelayMs, executionPlan);
      await app.close();
      appClosed = true;
      const videoPath = pageVideo ? await pageVideo.path().catch(() => null) : null;
      const artifactPaths = fs.readdirSync(artifactsDir).map((n) => path.join(artifactsDir, n));
      return {
        ...pageResult,
        videoPath: resolveRunVideoPath({ videoPath, artifacts: artifactPaths }, artifactsDir),
        artifacts: artifactPaths
      };
    } finally {
      if (!appClosed) {
        await app.close().catch(() => {});
      }
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordVideo: { dir: artifactsDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  let pageResult;
  try {
    pageResult = await executePageSteps(page, parser, artifactsDir, actionDelayMs, executionPlan);
  } finally {
    await context.close();
    await browser.close();
  }

  const videos = fs
    .readdirSync(artifactsDir)
    .filter((n) => n.endsWith(".webm"))
    .map((n) => path.join(artifactsDir, n));

  return {
    ...pageResult,
    videoPath: videos[0] || null,
    artifacts: fs.readdirSync(artifactsDir).map((n) => path.join(artifactsDir, n))
  };
}

class AgenticLoopManager {
  constructor(input) {
    const { workspaceRoot, storageRoot } = normalizeRuntimeRoots(input);
    this.projectRoot = workspaceRoot;
    this.storageRoot = storageRoot;
    this.store = new AgenticStore(storageRoot);
    this.criticAgent = new RunCriticAgent(workspaceRoot);
    process.env.JUNGLE_PROJECT_ROOT = workspaceRoot;
    process.env.JUNGLE_STORAGE_ROOT = storageRoot;
    this.persistence = new AgenticMySqlPersistenceService();
    this.activePersistentRunIds = new Set();
    this.approvalPollIntervalMs = Number(process.env.JUNGLE_APPROVAL_POLL_INTERVAL_MS || APPROVAL_POLL_INTERVAL_MS);
    this.approvalScanPromise = null;
    this.approvalWatcherTimer = null;

    if (this.persistence.isEnabled()) {
      this.startApprovalWatcher();
    }
  }

  listForests() {
    return this.store.listForests();
  }

  listTrees(forestId) {
    return this.store.listTrees(forestId);
  }

  listRuns(forestId) {
    return this.store.listRuns(forestId);
  }

  async listProjects() {
    return this.persistence.listProjects();
  }

  async listAwaitingApprovalRuns(projectId = null) {
    return this.persistence.listAwaitingApprovalRuns(projectId);
  }

  async listInProgressRuns(projectId = null) {
    return this.persistence.listInProgressRuns(projectId);
  }

  async listProjectTestRuns(projectId) {
    return this.persistence.listTestRunsByProject(projectId);
  }

  async getProjectTestRun(runId) {
    return this.persistence.getTestRunDetail(runId);
  }

  startApprovalWatcher() {
    if (this.approvalWatcherTimer || !this.persistence.isEnabled()) {
      return;
    }

    this.approvalWatcherTimer = setInterval(() => {
      this.processApprovedRuns().catch(() => {
        // ignore background worker errors; they are persisted on the run itself
      });
    }, this.approvalPollIntervalMs);

    if (typeof this.approvalWatcherTimer.unref === "function") {
      this.approvalWatcherTimer.unref();
    }

    setTimeout(() => {
      this.processApprovedRuns().catch(() => {
        // ignore startup scan failures; next poll will retry
      });
    }, 0);
  }

  kickApprovalWatcher() {
    if (!this.persistence.isEnabled()) {
      return;
    }
    this.processApprovedRuns().catch(() => {
      // ignore manual kick failures; status remains durable in MySQL
    });
  }

  async createDraft(input) {
    const env = { ...parseDotEnv(this.projectRoot), ...process.env };
    const environmentPlan = await planExecutionEnvironment({
      projectRoot: this.projectRoot,
      input,
      openAiApiKey: env.OPENAI_API_KEY
    });
    const environmentSession = await ensureExecutionEnvironment(environmentPlan);
    let inspection;
    let procedure;
    try {
      inspection = await inspectTarget(environmentPlan, {
        projectRoot: this.projectRoot,
        url: input.url
      });
      procedure = await generateProcedureWithGemini(
        env.GEMINI_API_KEY,
        inspection,
        input.objective || "Validate critical user flow",
        appendRequiredPortfolioBugChecks(
          input.objective || "Validate critical user flow",
          input.notes || "",
          input.projectName || ""
        ),
        environmentPlan,
        input.projectName || ""
      );
    } finally {
      await environmentSession.cleanup();
    }

    const parser = buildRequestParser(procedure);
    const forest = input.forestId ? this.store.getForest(input.forestId) : this.store.createForest(input);
    const { tree } = this.store.addTree(forest.forestId, {
      procedure,
      requestParser: parser,
      executionProfile: {
        environmentPlan,
        recordVideo: true,
        mode: environmentPlan.playwrightMode,
        targetType: environmentPlan.targetType
      }
    });

    return { forestId: forest.forestId, tree };
  }

  runMeetsQualityGate(run) {
    if (!run || run.status !== "pass") {
      return false;
    }
    const steps = Array.isArray(run.steps) ? run.steps : [];
    const semanticsOk = Boolean(run.semantics?.overallPass);
    const hasInteraction = steps.some((s) =>
      ["click", "fill", "scrollpage"].includes(String(s.action || "").toLowerCase())
    );
    const hasAssertion = steps.some((s) => String(s.action || "").toLowerCase().includes("assert"));
    return semanticsOk && hasInteraction && hasAssertion;
  }

  async approveRun(input) {
    const approvedRun = await this.persistence.approveRun({
      runId: input?.runId,
      approvedBy: input?.approvedBy || "ui",
      testingInstructions:
        typeof input?.testingInstructions === "string" ? input.testingInstructions : undefined
    });
    if (approvedRun) {
      this.kickApprovalWatcher();
    }
    return approvedRun;
  }

  async updateRunTestingInstructions(input) {
    return this.persistence.updateRunTestingInstructions({
      runId: input?.runId,
      testingInstructions: typeof input?.testingInstructions === "string" ? input.testingInstructions : "",
      editedBy: input?.editedBy || "ui"
    });
  }

  async updateRunPreview(input) {
    return this.persistence.updateRunPreview({
      runId: input?.runId,
      previewPath: typeof input?.previewPath === "string" ? input.previewPath : "",
      previewTitle: typeof input?.previewTitle === "string" ? input.previewTitle : "",
      previewType: typeof input?.previewType === "string" ? input.previewType : ""
    });
  }

  async createVariantRun(input) {
    if (!this.persistence.isEnabled()) {
      throw new Error("Variant runs require MySQL-backed persistence to be enabled");
    }

    const sourceRun = await this.persistence.getTestRunDetail(input?.sourceRunId);
    if (!sourceRun) {
      throw new Error(`Source run not found: ${input?.sourceRunId || "-"}`);
    }

    const seed = buildPersistentRunSeed(sourceRun, {
      notes: [
        `Variant derived from run ${sourceRun.id}.`,
        "Use the stored testing instructions as the baseline for this new approval-gated run."
      ].join("\n")
    });
    const project = await this.persistence.getOrCreateProjectByName(seed.projectName);
    const draftingRun = await this.persistence.createDraftingRun({
      projectId: project?.id,
      testingInstructions: `Creating variant packet from ${sourceRun.id}`,
      threePointSummary: ensureSummaryArray([
        "Variant preparation started.",
        `Source run: ${sourceRun.id}.`,
        "Execution has not started."
      ]),
      draftPayload: null
    });

    const variantDraftPayload = {
      actionDelayMs: seed.actionDelayMs,
      additions: seed.additions,
      codexTimeoutMs: seed.codexTimeoutMs,
      forestId: null,
      maxAttempts: seed.maxAttempts,
      notes: seed.notes,
      objective: seed.objective,
      procedure: null,
      projectName: seed.projectName,
      requestParser: null,
      skipCodex: seed.skipCodex,
      sourceRunId: sourceRun.id,
      targetType: seed.targetType,
      treeId: null,
      url: seed.url,
      variantSeedInstructions: seed.testingInstructions
    };

    return this.persistence.markRunAwaitingApproval({
      testRunId: draftingRun.id,
      testingInstructions: typeof input?.testingInstructions === "string" ? input.testingInstructions : seed.testingInstructions,
      threePointSummary: buildVariantRunSummary(sourceRun.id),
      draftPayload: variantDraftPayload
    });
  }

  async cancelRun(input) {
    return this.persistence.cancelRun({
      runId: input?.runId,
      reason: input?.reason || "Run cancelled from the UI."
    });
  }

  async processApprovedRuns() {
    if (!this.persistence.isEnabled()) {
      return [];
    }
    if (this.approvalScanPromise) {
      return this.approvalScanPromise;
    }

    this.approvalScanPromise = (async () => {
      const approvedRuns = await this.persistence.listRunsByStatuses(["approved"], { limit: 25 });
      approvedRuns.forEach((run) => {
        if (!run?.id) {
          return;
        }
        this.resumeApprovedRun(run.id).catch(() => {
          // ignore background worker failures; the failure is persisted on the run itself
        });
      });
      return approvedRuns;
    })().finally(() => {
      this.approvalScanPromise = null;
    });

    return this.approvalScanPromise;
  }

  restoreDraftFromPayload(draftPayload, run) {
    const payload = draftPayload || {};
    const existingForest = payload.forestId ? this.store.getForest(payload.forestId) : null;
    const existingTree = existingForest?.trees.find((tree) => tree.treeId === payload.treeId) || null;
    if (existingTree) {
      return {
        forestId: existingForest.forestId,
        tree: existingTree,
        rehydrated: false
      };
    }
    if (!payload.procedure) {
      return null;
    }

    const forest =
      existingForest ||
      this.store.createForest({
        projectName: payload.projectName || run?.projectName || "Jungle",
        url: payload.url || "http://127.0.0.1:3000",
        objective: payload.objective || "Validate critical user flow"
      });
    const { tree } = this.store.addTree(forest.forestId, {
      procedure: payload.procedure,
      requestParser: payload.requestParser || buildRequestParser(payload.procedure),
      executionProfile: {
        recordVideo: true,
        mode: payload.targetType === "electron_app" ? "electron" : "web",
        targetType: payload.targetType || "web_frontend"
      }
    });

    return {
      forestId: forest.forestId,
      tree,
      rehydrated: true
    };
  }

  async hydratePersistentDraft(run) {
    const restored = this.restoreDraftFromPayload(run?.draftPayload || {}, run);
    if (!restored) {
      const seed = buildPersistentRunSeed(run, {
        notes: buildApprovedExecutionNotes(run?.draftPayload || {}, run?.testingInstructions || "")
      });
      const draft = await this.createDraft({
        additions: seed.additions,
        notes: seed.notes,
        objective: seed.objective,
        projectName: seed.projectName,
        targetType: seed.targetType,
        url: seed.url
      });
      const nextPayload = {
        ...(run?.draftPayload || {}),
        actionDelayMs: seed.actionDelayMs,
        additions: seed.additions,
        codexTimeoutMs: seed.codexTimeoutMs,
        forestId: draft.forestId,
        maxAttempts: seed.maxAttempts,
        notes: seed.notes,
        objective: seed.objective,
        procedure: draft.tree.procedure,
        projectName: seed.projectName,
        requestParser: draft.tree.requestParser,
        skipCodex: seed.skipCodex,
        targetType: seed.targetType,
        treeId: draft.tree.treeId,
        url: seed.url
      };
      const updatedRun = await this.persistence.updateRunDraftPayload({
        testRunId: run.id,
        testingInstructions: run?.testingInstructions || "",
        threePointSummary: run?.threePointSummary || ensureSummaryArray([]),
        draftPayload: nextPayload
      });
      return {
        draft,
        generatedFromInstructions: true,
        run: updatedRun || run
      };
    }

    if (!restored.rehydrated && restored.forestId === run?.draftPayload?.forestId && restored.tree?.treeId === run?.draftPayload?.treeId) {
      return {
        draft: {
          forestId: restored.forestId,
          tree: restored.tree
        },
        generatedFromInstructions: false,
        run
      };
    }

    const nextPayload = {
      ...(run?.draftPayload || {}),
      forestId: restored.forestId,
      treeId: restored.tree.treeId,
      procedure: restored.tree.procedure,
      requestParser: restored.tree.requestParser
    };
    const updatedRun = await this.persistence.updateRunDraftPayload({
      testRunId: run.id,
      testingInstructions: buildTestingInstructions(
        nextPayload.objective || "Validate critical user flow",
        nextPayload,
        restored.tree.procedure
      ),
      threePointSummary: run.threePointSummary,
      draftPayload: nextPayload
    });

    return {
      draft: {
        forestId: restored.forestId,
        tree: restored.tree
      },
      generatedFromInstructions: false,
      run: updatedRun || run
    };
  }

  async finalizeCancelledPersistentRun(runId, startedAtMs, last, reason) {
    const latestRun = await this.persistence.getRunRecord(runId);
    if (!latestRun) {
      return null;
    }

    return this.persistence.finalizeRun({
      testRunId: runId,
      executionTimeMs: Date.now() - startedAtMs,
      loopCount: await this.persistence.getLoopCount(runId),
      status: "cancelled",
      testingInstructions: latestRun.testingInstructions || "",
      videoReference: resolveRunVideoPath(last?.run),
      threePointSummary: buildCancelledSummary(reason || latestRun.lastErrorText || last?.run?.summary),
      lastErrorText: reason || latestRun.lastErrorText || "Run cancelled by user."
    });
  }

  async executeImmediateOrchestration(input, emitEvent, objective, maxAttempts) {
    const workingInput = { ...input };
    let last = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      emitEvent?.({ type: "agentic_status", value: `Starting orchestration loop attempt ${attempt}/${maxAttempts}...` });
      emitEvent?.({ type: "agentic_status", value: "Converting task into test procedure..." });

      const draft = await this.createDraft({
        additions: workingInput.additions,
        forestId: workingInput.forestId,
        notes: attempt > 1 ? buildRetryNotes(workingInput.notes || "", last?.run) : workingInput.notes || "",
        objective,
        projectName: workingInput.projectName || "Jungle",
        targetType: workingInput.targetType,
        url: workingInput.url
      });

      emitEvent?.({
        type: "agentic_status",
        value: `Generated ${draft.tree.requestParser.normalizedSteps.length} step(s). Executing with Playwright...`
      });

      const runResult = await this.confirmAndRun(
        {
          additions: workingInput.additions || "",
          codexTimeoutMs: workingInput.codexTimeoutMs,
          forestId: draft.forestId,
          skipCodex: workingInput.skipCodex,
          targetType: workingInput.targetType,
          treeId: draft.tree.treeId,
          url: workingInput.url
        },
        emitEvent
      );

      last = {
        forestId: draft.forestId,
        objective,
        procedure: draft.tree.procedure,
        run: runResult.run,
        tree: draft.tree,
        treeId: draft.tree.treeId
      };

      if (this.runMeetsQualityGate(runResult.run)) {
        return last;
      }

      emitEvent?.({
        type: "agentic_status",
        value: `Quality gate failed on attempt ${attempt}. Retrying within the approved feature scope...`
      });
      workingInput.forestId = draft.forestId;
    }

    return last;
  }

  async prepareApprovalRun(input, emitEvent, objective, maxAttempts) {
    const project = await this.persistence.getOrCreateProjectByName(input.projectName || "Jungle");
    const draftingRun = await this.persistence.createDraftingRun({
      projectId: project?.id,
      testingInstructions: `Drafting approval packet for: ${objective}`,
      threePointSummary: ensureSummaryArray([
        "Draft generation started.",
        "The orchestration is preparing a testing plan.",
        "Execution has not started."
      ]),
      draftPayload: null
    });

    emitEvent?.({ type: "agentic_status", value: "Preparing draft for approval..." });

    try {
      const draft = await this.createDraft({
        additions: input.additions,
        forestId: input.forestId,
        notes: input.notes || "",
        objective,
        projectName: input.projectName || "Jungle",
        targetType: input.targetType,
        url: input.url
      });
      const draftPayload = buildDraftPayload({
        input,
        objective,
        draft,
        maxAttempts,
        attempt: 1
      });
      const testingInstructions = buildTestingInstructions(objective, input, draft.tree.procedure);
      const approvalRun = await this.persistence.markRunAwaitingApproval({
        testRunId: draftingRun.id,
        testingInstructions,
        threePointSummary: buildApprovalSummary(draft.tree.procedure, input.url),
        draftPayload
      });

      emitEvent?.({
        type: "agentic_status",
        value: `Draft prepared. Run ${approvalRun.id} is waiting for approval before execution.`
      });

      return {
        awaitingApproval: true,
        forestId: draft.forestId,
        treeId: draft.tree.treeId,
        procedure: draft.tree.procedure,
        run: approvalRun
      };
    } catch (error) {
      const semanticInterpretation = buildDeterministicSemanticInterpretation({
        objective,
        loopCount: 0,
        procedure: null,
        run: {
          summary: error.message,
          semantics: { wrong: ["Draft generation failed before execution completed."] }
        },
        critique: {
          summary: "Draft generation failed before execution could start.",
          confidence: 0.5,
          strengths: [],
          issues: [
            {
              severity: "critical",
              description: "Execution could not start because the approval draft was not generated.",
              evidence: error.message,
              fix: "Inspect planner inputs, startup commands, and target environment readiness."
            }
          ]
        }
      });
      const failureInterpretation = deriveFailureInterpretation({
        run: {
          summary: error.message,
          semantics: {
            verdict: "fail",
            wrong: ["draft_generation: could not produce an executable approval draft"]
          },
          critique: {
            issues: [
              {
                severity: "critical",
                description: "Draft generation failed before execution could start.",
                evidence: error.message,
                fix: "Inspect the planning prompt, target environment, and available startup commands."
              }
            ]
          }
        },
        objective,
        procedure: null,
        testingInstructions: draftingRun?.testingInstructions || "",
        lastErrorText: error.message,
        status: "failed"
      });
      await this.persistence.markRunFailedDuringDraft({
        testRunId: draftingRun.id,
        lastErrorText: error.message,
        threePointSummary: buildFailureSummary(error.message),
        draftPayload: withFailureInterpretationDraftPayload(null, failureInterpretation),
        semanticVerdict: semanticInterpretation.verdict,
        semanticInterpretation
      });
      throw error;
    }
  }

  async executePersistentOrchestration(input, emitEvent, objective, maxAttempts, persistentRun, initialDraft) {
    const startedAtMs = Date.now();
    const workingInput = { ...input, forestId: initialDraft?.forestId || input.forestId };
    let last = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const currentStatus = await this.persistence.getRunStatus(persistentRun.id);
      if (currentStatus === "cancelled") {
        const cancelledRun = await this.finalizeCancelledPersistentRun(
          persistentRun.id,
          startedAtMs,
          last,
          "Run cancelled before the next loop started."
        );
        return {
          ...last,
          persistentRun: cancelledRun
        };
      }

      const persistedLoopCount = await this.persistence.getLoopCount(persistentRun.id);
      if (attempt > MAX_AGENTIC_LOOPS || persistedLoopCount >= MAX_AGENTIC_LOOPS) {
        const latestRun = await this.persistence.getRunRecord(persistentRun.id);
        const semanticInterpretation = await generateSemanticInterpretationWithGemini(process.env.GEMINI_API_KEY, {
          objective,
          loopCount: Math.min(MAX_AGENTIC_LOOPS, persistedLoopCount),
          procedure: last?.procedure || latestRun?.draftPayload?.procedure || null,
          run: last?.run || {
            summary: "Maximum loop count reached before a passing run.",
            semantics: { wrong: [] },
            critique: { issues: [] }
          },
          critique: last?.run?.critique || { issues: [], strengths: [] }
        });
        const finalizedRun = await this.persistence.finalizeRun({
          testRunId: persistentRun.id,
          executionTimeMs: Date.now() - startedAtMs,
          loopCount: Math.min(MAX_AGENTIC_LOOPS, persistedLoopCount),
          status: "completed",
          testingInstructions: latestRun?.testingInstructions || "",
          videoReference: resolveRunVideoPath(last?.run),
          threePointSummary: buildSemanticSummary(
            semanticInterpretation,
            last?.run?.summary || "Execution completed after the maximum five iterations."
          ),
          lastErrorText: null,
          semanticVerdict: semanticInterpretation.verdict,
          semanticInterpretation
        });
        return {
          ...last,
          persistentRun: finalizedRun
        };
      }

      emitEvent?.({ type: "agentic_status", value: `Starting approved orchestration loop ${attempt}/${maxAttempts}...` });
      emitEvent?.({ type: "agentic_status", value: "Converting approved draft into executable steps..." });

      let draft = initialDraft && attempt === 1 ? initialDraft : null;
      try {
        if (!draft) {
          draft = await this.createDraft({
            additions: workingInput.additions,
            forestId: workingInput.forestId,
            notes: buildRetryNotes(workingInput.notes || "", last?.run),
            objective,
            projectName: workingInput.projectName || "Jungle",
            targetType: workingInput.targetType,
            url: workingInput.url
          });
        }

        if (attempt > 1) {
          const refreshedDraftPayload = buildDraftPayload({
            input: workingInput,
            objective,
            draft,
            maxAttempts,
            attempt
          });
          await this.persistence.updateRunDraftPayload({
            testRunId: persistentRun.id,
            testingInstructions: buildTestingInstructions(objective, workingInput, draft.tree.procedure),
            threePointSummary: buildApprovalSummary(draft.tree.procedure, workingInput.url),
            draftPayload: refreshedDraftPayload
          });
        }

        emitEvent?.({
          type: "agentic_status",
          value: `Generated ${draft.tree.requestParser.normalizedSteps.length} step(s). Executing with Playwright...`
        });

        const runResult = await this.confirmAndRun(
          {
            additions: workingInput.additions || "",
            codexTimeoutMs: workingInput.codexTimeoutMs,
            forestId: draft.forestId,
            skipCodex: workingInput.skipCodex,
            targetType: workingInput.targetType,
            treeId: draft.tree.treeId,
            url: workingInput.url,
            actionDelayMs: workingInput.actionDelayMs
          },
          emitEvent
        );

        last = {
          forestId: draft.forestId,
          objective,
          procedure: draft.tree.procedure,
          run: runResult.run,
          tree: draft.tree,
          treeId: draft.tree.treeId
        };

        const runPassedQualityGate = this.runMeetsQualityGate(runResult.run);
        const loopState = await this.persistence.persistLoopAndRunState({
          testRunId: persistentRun.id,
          loopNumber: attempt,
          loopStatus: runPassedQualityGate ? "passed" : "failed",
          stepSummary: runResult.run.summary || `Loop ${attempt} completed`,
          artifacts: buildLoopArtifacts(runResult.run),
          runStatus: "in_progress",
          lastErrorText: runPassedQualityGate ? null : runResult.run.summary || "Quality gate failed"
        });

        if (loopState?.status === "cancelled" || (await this.persistence.getRunStatus(persistentRun.id)) === "cancelled") {
          const cancelledRun = await this.finalizeCancelledPersistentRun(
            persistentRun.id,
            startedAtMs,
            last,
            "Run cancelled after loop persistence."
          );
          return {
            ...last,
            persistentRun: cancelledRun
          };
        }

        if (runPassedQualityGate) {
          const latestRun = await this.persistence.getRunRecord(persistentRun.id);
          const semanticInterpretation = await generateSemanticInterpretationWithGemini(process.env.GEMINI_API_KEY, {
            objective,
            loopCount: attempt,
            procedure: draft.tree.procedure,
            run: runResult.run,
            critique: runResult.run?.critique || { issues: [], strengths: [] }
          });
          const finalizedRun = await this.persistence.finalizeRun({
            testRunId: persistentRun.id,
            executionTimeMs: Date.now() - startedAtMs,
            loopCount: attempt,
            status: "completed",
            testingInstructions: latestRun?.testingInstructions || "",
            videoReference: resolveRunVideoPath(runResult.run),
            threePointSummary: buildSemanticSummary(
              semanticInterpretation,
              runResult.run?.summary || "Execution completed with sufficient evidence."
            ),
            lastErrorText: null,
            semanticVerdict: semanticInterpretation.verdict,
            semanticInterpretation
          });
          return {
            ...last,
            persistentRun: finalizedRun
          };
        }

        emitEvent?.({
          type: "agentic_status",
          value: `Quality gate failed on attempt ${attempt}. Retrying with a tighter feature-scoped draft...`
        });
        workingInput.forestId = draft.forestId;
      } catch (error) {
        const statusAfterError = await this.persistence.getRunStatus(persistentRun.id);
        if (statusAfterError === "cancelled") {
          const cancelledRun = await this.finalizeCancelledPersistentRun(
            persistentRun.id,
            startedAtMs,
            last,
            error.message || "Run cancelled during execution."
          );
          return {
            ...last,
            persistentRun: cancelledRun
          };
        }

        await this.persistence.persistLoopAndRunState({
          testRunId: persistentRun.id,
          loopNumber: attempt,
          loopStatus: "failed",
          stepSummary: `Loop ${attempt} failed before completion: ${error.message}`,
          artifacts: {
            screenshot_refs: [],
            console_errors: [error.message],
            video_chunk_refs: [],
            critic_output: null,
            structured_metrics: {},
            artifact_refs: []
          },
          runStatus: "in_progress",
          lastErrorText: error.message
        });

        const latestRun = await this.persistence.getRunRecord(persistentRun.id);
        const semanticInterpretation = buildDeterministicSemanticInterpretation({
          objective,
          loopCount: attempt,
          procedure: last?.procedure || latestRun?.draftPayload?.procedure || null,
          run: {
            summary: error.message,
            semantics: {
              wrong: ["Execution stopped before a full semantic observation could be completed."]
            }
          },
          critique: {
            summary: "Execution failed before semantic interpretation could complete.",
            confidence: 0.5,
            strengths: [],
            issues: [
              {
                severity: "critical",
                description: "The automation session terminated before the intended UI/UX observation finished.",
                evidence: error.message,
                fix: "Stabilize selectors, waits, or environment startup before relying on semantic assessment."
              }
            ]
          }
        });
        const failureInterpretation = deriveFailureInterpretation({
          run: {
            summary: error.message,
            semantics: {
              verdict: "fail",
              wrong: ["execution_exception: loop failed before completion"]
            },
            critique: {
              issues: [
                {
                  severity: "critical",
                  description: "Execution threw before the loop could complete.",
                  evidence: error.message,
                  fix: "Inspect failing selectors, startup timing, and runtime preconditions."
                }
              ]
            }
          },
          objective,
          procedure: last?.procedure || latestRun?.draftPayload?.procedure || null,
          testingInstructions: latestRun?.testingInstructions || "",
          lastErrorText: error.message,
          status: "failed"
        });
        const finalizedRun = await this.persistence.finalizeRun({
          testRunId: persistentRun.id,
          executionTimeMs: Date.now() - startedAtMs,
          loopCount: attempt,
          status: "failed_execution",
          testingInstructions: latestRun?.testingInstructions || "",
          videoReference: resolveRunVideoPath(last?.run),
          threePointSummary: buildFailureSummary(error.message),
          lastErrorText: error.message,
          draftPayload: withFailureInterpretationDraftPayload(latestRun?.draftPayload, failureInterpretation),
          semanticVerdict: semanticInterpretation.verdict,
          semanticInterpretation
        });

        return {
          ...last,
          persistentRun: finalizedRun,
          error
        };
      }
    }

    const latestRun = await this.persistence.getRunRecord(persistentRun.id);
    const semanticInterpretation = await generateSemanticInterpretationWithGemini(process.env.GEMINI_API_KEY, {
      objective,
      loopCount: await this.persistence.getLoopCount(persistentRun.id),
      procedure: last?.procedure || latestRun?.draftPayload?.procedure || null,
      run: last?.run || {
        summary: "Execution completed after the maximum loop count.",
        semantics: { wrong: [] },
        critique: { issues: [] }
      },
      critique: last?.run?.critique || { issues: [], strengths: [] }
    });
    const finalizedRun = await this.persistence.finalizeRun({
      testRunId: persistentRun.id,
      executionTimeMs: Date.now() - startedAtMs,
      loopCount: await this.persistence.getLoopCount(persistentRun.id),
      status: "completed",
      testingInstructions: latestRun?.testingInstructions || "",
      videoReference: resolveRunVideoPath(last?.run),
      threePointSummary: buildSemanticSummary(
        semanticInterpretation,
        last?.run?.summary || "Execution completed after the maximum five iterations."
      ),
      lastErrorText: null,
      semanticVerdict: semanticInterpretation.verdict,
      semanticInterpretation
    });

    return {
      ...last,
      persistentRun: finalizedRun
    };
  }

  async resumeApprovedRun(runId, emitEvent) {
    if (!this.persistence.isEnabled() || !runId) {
      return null;
    }
    if (this.activePersistentRunIds.has(runId)) {
      return null;
    }

    this.activePersistentRunIds.add(runId);
    try {
      const claimedRun = await this.persistence.claimApprovedRunForExecution(runId);
      if (!claimedRun) {
        return null;
      }

      const hydrated = await this.hydratePersistentDraft(claimedRun);
      const draftPayload = hydrated.run?.draftPayload || {};
      const approvedTestingInstructions = hydrated.run?.testingInstructions || "";
      const hasApprovalInstructionEdits = Boolean(draftPayload?.approvalInstructionEditedAt);
      const shouldRegenerateOnExecution = hasApprovalInstructionEdits && !hydrated.generatedFromInstructions;
      const maxAttemptsRaw = Number(draftPayload.maxAttempts || MAX_AGENTIC_LOOPS);
      const maxAttempts = Math.min(
        MAX_AGENTIC_LOOPS,
        Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? maxAttemptsRaw : MAX_AGENTIC_LOOPS
      );

      emitEvent?.({
        type: "agentic_status",
        value: `Approval detected for run ${runId}. Resuming execution...`
      });

      return await this.executePersistentOrchestration(
        {
          additions: draftPayload.additions || "",
          actionDelayMs: draftPayload.actionDelayMs,
          codexTimeoutMs: draftPayload.codexTimeoutMs,
          forestId: hydrated.draft.forestId,
          notes: buildApprovedExecutionNotes(draftPayload, approvedTestingInstructions),
          projectName: draftPayload.projectName || hydrated.run.projectName || "Jungle",
          skipCodex: draftPayload.skipCodex,
          targetType: draftPayload.targetType || "web_frontend",
          url: draftPayload.url || "http://127.0.0.1:3000"
        },
        emitEvent,
        draftPayload.objective || "Validate critical user flow",
        maxAttempts,
        hydrated.run,
        shouldRegenerateOnExecution ? null : hydrated.draft
      );
    } finally {
      this.activePersistentRunIds.delete(runId);
    }
  }

  async orchestrateTask(input, emitEvent) {
    const objective =
      (typeof input.task === "string" && input.task.trim()) ||
      (typeof input.objective === "string" && input.objective.trim()) ||
      "Validate critical user flow";
    const requestedMaxAttempts = Number(input.maxAttempts || MAX_AGENTIC_LOOPS);
    const maxAttempts = Math.min(
      MAX_AGENTIC_LOOPS,
      Number.isFinite(requestedMaxAttempts) && requestedMaxAttempts > 0 ? requestedMaxAttempts : MAX_AGENTIC_LOOPS
    );

    if (!this.persistence.isEnabled()) {
      return this.executeImmediateOrchestration(input, emitEvent, objective, maxAttempts);
    }

    return this.prepareApprovalRun(input, emitEvent, objective, maxAttempts);
  }

  async confirmAndRun(input, emitEvent) {
    const trees = this.store.listTrees(input.forestId);
    const tree = trees.find((t) => t.treeId === input.treeId);
    if (!tree) throw new Error("Tree not found for confirmation");
    const env = { ...parseDotEnv(this.projectRoot), ...process.env };
    const executionPlan =
      tree.executionProfile?.environmentPlan ||
      (await planExecutionEnvironment({
        projectRoot: this.projectRoot,
        input,
        openAiApiKey: env.OPENAI_API_KEY
      }));
    const environmentSession = await ensureExecutionEnvironment(executionPlan);

    try {
      let finalProcedure = {
        ...tree.procedure,
        notes: [tree.procedure.notes || "", input.additions || ""].filter(Boolean).join("\n")
      };

      if (input.forceFallback) {
        const inspection = await inspectTarget(executionPlan, {
          projectRoot: this.projectRoot,
          url: input.url
        });
        finalProcedure = fallbackProcedure(
          inspection,
          finalProcedure.summary || "Validate critical user flow",
          finalProcedure.notes || "",
          executionPlan
        );
      }

      const inspection = await inspectTarget(executionPlan, {
        projectRoot: this.projectRoot,
        url: input.url
      });
      if (shouldFallbackToDeterministicProcedure(finalProcedure, inspection, executionPlan)) {
        emitEvent?.({
          type: "agentic_status",
          value: "Detected unstable planner output. Switching to deterministic fallback procedure."
        });
        finalProcedure = fallbackProcedure(
          inspection,
          finalProcedure.summary || "Validate critical user flow",
          finalProcedure.notes || "",
          executionPlan
        );
      }

      const normalizedParser = buildRequestParser(finalProcedure);
      const artifactsDir = path.join(
        this.storageRoot,
        "db",
        "agentic_artifacts",
        `${input.forestId}_${input.treeId}_${Date.now()}`
      );
      ensureDir(artifactsDir);

      const actionDelayMs = Number(input.actionDelayMs ?? 500);
      const playwrightProgram = generatePlaywrightProgram(normalizedParser, actionDelayMs, executionPlan);
      const parserPath = path.join(artifactsDir, "request_parser.json");
      const programPath = path.join(artifactsDir, "playwright_executor.generated.js");
      fs.writeFileSync(parserPath, JSON.stringify(normalizedParser, null, 2), "utf8");
      fs.writeFileSync(programPath, playwrightProgram, "utf8");

      emitEvent?.({ type: "agentic_status", value: "WELCOME TO THE JUNGLE" });
      emitEvent?.({ type: "agentic_status", value: "Codex terminal calls MCP to initiate testing procedure..." });

      const codexMcpResult = input.skipCodex
        ? {
            status: "skipped",
            pass: false,
            reason: "Codex step skipped by input flag",
            stdout: "",
            stderr: ""
          }
        : await runCodexMcpStep({
            objective: finalProcedure.summary,
            url: executionPlan.launchTarget?.value || input.url,
            inspection: {
              ...inspection,
              targetType: executionPlan.targetType,
              playwrightMode: executionPlan.playwrightMode
            },
            timeoutMs: input.codexTimeoutMs || 120000,
            cwd: this.projectRoot
          });

      const codexTranscriptPath = path.join(artifactsDir, "codex_mcp_transcript.txt");
      fs.writeFileSync(
        codexTranscriptPath,
        [`status=${codexMcpResult.status}`, `reason=${codexMcpResult.reason}`, "", codexMcpResult.stdout, "", codexMcpResult.stderr].join("\n"),
        "utf8"
      );

      emitEvent?.({
        type: "agentic_status",
        value: codexMcpResult.pass
          ? "Codex MCP planning complete. Converting into Request Parser and Playwright Executor..."
          : `Codex MCP unavailable (${codexMcpResult.reason}). Continuing with local planner.`
      });

      const result = await executeProcedure(executionPlan, normalizedParser, artifactsDir, actionDelayMs);
      const resolvedVideoPath = resolveRunVideoPath(result, artifactsDir);
      const preliminaryRun = {
        status: result.status,
        summary: result.summary,
        targetType: executionPlan.targetType,
        steps: result.steps,
        artifacts: [
          { type: "parser", path: parserPath },
          { type: "executor", path: programPath }
        ].concat(result.artifacts.map((p) => ({ type: p.endsWith(".webm") ? "video" : "artifact", path: p }))),
        videoPath: resolvedVideoPath
      };
      const semantics = analyzeRunSemantics(preliminaryRun, this.projectRoot);
      const semanticsPath = path.join(artifactsDir, "semantic_report.json");
      fs.writeFileSync(semanticsPath, JSON.stringify(semantics, null, 2), "utf8");

      const critique = await this.criticAgent.analyze({
        objective: finalProcedure.summary || "Validate critical user flow",
        procedure: finalProcedure,
        run: {
          status: result.status,
          summary: result.summary,
          steps: result.steps,
          videoPath: resolvedVideoPath,
          semantics
        }
      });
      const critiquePath = path.join(artifactsDir, "critique_report.json");
      fs.writeFileSync(critiquePath, JSON.stringify(critique, null, 2), "utf8");

      const run = this.store.addRun(input.forestId, input.treeId, {
        status: result.status,
        targetType: executionPlan.targetType,
        steps: result.steps,
        artifacts: [
          { type: "codex_mcp", path: codexTranscriptPath },
          { type: "parser", path: parserPath },
          { type: "executor", path: programPath },
          { type: "semantic", path: semanticsPath },
          { type: "critique", path: critiquePath }
        ].concat(result.artifacts.map((p) => ({ type: p.endsWith(".webm") ? "video" : "artifact", path: p }))),
        videoPath: resolvedVideoPath,
        summary: result.summary,
        semantics,
        critique
      });

      this.store.updateTree(input.forestId, input.treeId, (draft) => ({
        ...draft,
        status: run.status === "pass" ? "validated" : "failed",
        requestParser: normalizedParser,
        confirmedAt: nowIso(),
        procedure: finalProcedure
      }));

      return { run, treeId: input.treeId, forestId: input.forestId };
    } finally {
      await environmentSession.cleanup();
    }
  }

  async redoRun(input, emitEvent) {
    return this.confirmAndRun(input, emitEvent);
  }

  async forkTree(input) {
    const trees = this.store.listTrees(input.forestId);
    const source = trees.find((t) => t.treeId === input.fromTreeId);
    if (!source) throw new Error("Source tree not found");

    const tweaked = {
      ...source.procedure,
      summary: `${source.procedure.summary} (forked variant)`,
      notes: [source.procedure.notes || "", input.notes || ""].filter(Boolean).join("\n")
    };

    const { tree } = this.store.addTree(input.forestId, {
      procedure: tweaked,
      requestParser: buildRequestParser(tweaked),
      executionProfile: source.executionProfile
    });

    return tree;
  }
}

module.exports = {
  AgenticLoopManager,
  buildRequestParser,
  generatePlaywrightProgram
};
