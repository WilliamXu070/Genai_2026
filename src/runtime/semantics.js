const fs = require("node:fs");
const path = require("node:path");

const WEBM_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

function toAbsoluteArtifactPath(p, projectRoot) {
  if (!p) {
    return null;
  }
  if (path.isAbsolute(p)) {
    return p;
  }
  return projectRoot ? path.join(projectRoot, p) : path.resolve(p);
}

function checkWebmVideo(videoPath, projectRoot) {
  const resolved = toAbsoluteArtifactPath(videoPath, projectRoot);
  if (!resolved) {
    return { exists: false, headerValid: false, path: null, sizeBytes: 0, valid: false };
  }
  if (!fs.existsSync(resolved)) {
    return { exists: false, headerValid: false, path: resolved, sizeBytes: 0, valid: false };
  }

  const stat = fs.statSync(resolved);
  const sizeBytes = stat.size;
  let headerValid = false;

  if (sizeBytes >= 4) {
    const fd = fs.openSync(resolved, "r");
    try {
      const header = Buffer.alloc(4);
      fs.readSync(fd, header, 0, 4, 0);
      headerValid = header.equals(WEBM_HEADER);
    } finally {
      fs.closeSync(fd);
    }
  }

  return {
    exists: true,
    headerValid,
    path: resolved,
    sizeBytes,
    valid: sizeBytes > 0 && headerValid
  };
}

function analyzeRunSemantics(runLike, projectRoot) {
  const steps = Array.isArray(runLike?.steps) ? runLike.steps : [];
  const artifacts = Array.isArray(runLike?.artifacts) ? runLike.artifacts : [];
  const runStatus = runLike?.status || "unknown";
  const targetType = runLike?.targetType || "web_frontend";
  const requiresVideo = targetType !== "electron_app";
  const failedSteps = steps.filter((s) => s?.status === "fail");
  const parserArtifacts = artifacts.filter((a) => a?.type === "parser");
  const executorArtifacts = artifacts.filter((a) => a?.type === "executor");
  const video = checkWebmVideo(runLike?.videoPath, projectRoot);

  const checks = [
    {
      key: "steps_present",
      pass: steps.length > 0,
      detail: `steps=${steps.length}`
    },
    {
      key: "artifacts_present",
      pass: artifacts.length > 0,
      detail: `artifacts=${artifacts.length}`
    },
    {
      key: "parser_artifact",
      pass: parserArtifacts.length > 0,
      detail: `parserArtifacts=${parserArtifacts.length}`
    },
    {
      key: "executor_artifact",
      pass: executorArtifacts.length > 0,
      detail: `executorArtifacts=${executorArtifacts.length}`
    },
    {
      key: "video_valid_webm",
      pass: requiresVideo ? video.valid : true,
      detail: requiresVideo
        ? video.path
          ? `exists=${video.exists} size=${video.sizeBytes} headerValid=${video.headerValid}`
          : "missing video path"
        : "not required for electron_app"
    },
    {
      key: "run_status_consistent",
      pass: runStatus === "pass" ? failedSteps.length === 0 : failedSteps.length >= 1,
      detail: `status=${runStatus} failedSteps=${failedSteps.length}`
    }
  ];

  const right = [];
  const wrong = [];

  checks.forEach((check) => {
    if (check.pass) {
      right.push(`${check.key}: ${check.detail}`);
    } else {
      wrong.push(`${check.key}: ${check.detail}`);
    }
  });

  if (runStatus === "pass") {
    right.push(`run_summary: ${runLike?.summary || "pass without summary"}`);
  } else {
    wrong.push(`run_summary: ${runLike?.summary || "fail without summary"}`);
    const firstFailure = failedSteps[0];
    if (firstFailure?.note) {
      wrong.push(`failed_step_note: ${firstFailure.note}`);
    }
  }

  const checksPass = checks.every((c) => c.pass);
  const overallPass = runStatus === "pass" && checksPass;

  return {
    overallPass,
    verdict: overallPass ? "pass" : "fail",
    checks,
    right,
    wrong,
    video
  };
}

function analyzeOperationalSemantics(parsedState, uiInteraction, geminiSemantic) {
  const structuralChecks = Object.entries(parsedState || {}).map(([key, value]) => ({
    key: `structure_${key}`,
    pass: Boolean(value),
    detail: String(value)
  }));

  const uiChecks = [
    {
      key: "ui_preconditions",
      pass:
        Boolean(uiInteraction?.preClick?.appTitleVisible) &&
        Boolean(uiInteraction?.preClick?.scenarioPanelVisible) &&
        Boolean(uiInteraction?.preClick?.resultPanelVisible),
      detail: `preClick=${JSON.stringify(uiInteraction?.preClick || {})}`
    },
    {
      key: "ui_transition",
      pass: uiInteraction?.postClick?.runStateText?.trim() === "pass",
      detail: `postRunState=${uiInteraction?.postClick?.runStateText || ""}`
    },
    {
      key: "ui_result_summary",
      pass: (uiInteraction?.postClick?.summaryText || "").trim().length > 0,
      detail: `postSummaryLen=${(uiInteraction?.postClick?.summaryText || "").trim().length}`
    }
  ];

  const semanticChecks = [
    {
      key: "semantic_provider_response",
      pass: geminiSemantic?.status === "ok" ? Boolean(geminiSemantic?.pass) : true,
      detail: `status=${geminiSemantic?.status || "n/a"}`
    }
  ];

  const checks = structuralChecks.concat(uiChecks, semanticChecks);
  const right = checks.filter((c) => c.pass).map((c) => `${c.key}: ${c.detail}`);
  const wrong = checks.filter((c) => !c.pass).map((c) => `${c.key}: ${c.detail}`);

  return {
    overallPass: checks.every((c) => c.pass),
    verdict: checks.every((c) => c.pass) ? "pass" : "fail",
    checks,
    right,
    wrong
  };
}

module.exports = {
  analyzeOperationalSemantics,
  analyzeRunSemantics,
  checkWebmVideo
};
