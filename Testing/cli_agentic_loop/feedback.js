const path = require("node:path");

function summarizeArtifacts(execution) {
  const artifacts = Array.isArray(execution?.artifacts) ? execution.artifacts : [];
  const videoPath =
    execution?.video_path ||
    artifacts.find((p) => String(p).toLowerCase().endsWith(".webm")) ||
    null;
  return {
    artifactCount: artifacts.length,
    videoPath: videoPath ? path.resolve(videoPath) : null
  };
}

function toFixPacket(orchestration, iteration) {
  const critique = orchestration?.critique || {};
  const execution = orchestration?.execution || {};
  const defects = Array.isArray(critique.defects) ? critique.defects : [];
  const recommendations = Array.isArray(critique.recommendations) ? critique.recommendations : [];
  const topDefects = defects
    .slice()
    .sort((a, b) => Number(b.severity_0_10 || 0) - Number(a.severity_0_10 || 0))
    .slice(0, 5);

  const verdict = orchestration?.final_verdict || "fail";
  const severity = Number(critique.overall_severity || 0);
  const execStatus = execution?.status || "fail";
  const needsFix = verdict !== "pass" || execStatus !== "pass";
  const artifacts = summarizeArtifacts(execution);

  return {
    iteration,
    verdict,
    executionStatus: execStatus,
    escalated: Boolean(orchestration?.escalated),
    severity,
    summary: critique.summary || execution.summary || "No summary available.",
    topDefects,
    recommendations,
    artifacts,
    needsFix,
    codexInstruction: needsFix
      ? [
          "Apply targeted code fixes based on these test findings.",
          `Execution status: ${execStatus}; overall severity: ${severity}.`,
          topDefects.length > 0
            ? `Top defects: ${topDefects.map((d) => `${d.id || "unknown"}(${d.severity_0_10 || 0})`).join(", ")}`
            : "No explicit defects returned; inspect execution summary and artifacts.",
          recommendations.length > 0
            ? `Recommendations: ${recommendations.join(" | ")}`
            : "No recommendations returned; improve selectors/assertions and re-run."
        ].join(" ")
      : "No fix required. Gate passed."
  };
}

module.exports = {
  toFixPacket
};
