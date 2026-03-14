const fs = require("node:fs");
const path = require("node:path");

function parseNumericFromText(value) {
  const match = String(value || "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function deterministicCritique(input) {
  const run = input.run || {};
  const semantics = run.semantics || {};
  const issues = [];
  const strengths = [];

  if (run.status !== "pass") {
    issues.push({
      id: "run_failed",
      severity: "critical",
      description: run.summary || "Run failed without summary",
      evidence: run.steps?.find((s) => s.status === "fail")?.note || "No failed step note found",
      fix: "Fix failing selector/assertion and re-run with stronger deterministic checks."
    });
  } else {
    strengths.push("Execution completed with pass status.");
  }

  if (Array.isArray(semantics.wrong) && semantics.wrong.length > 0) {
    issues.push({
      id: "semantic_checks_failed",
      severity: "high",
      description: "One or more semantic checks failed.",
      evidence: semantics.wrong.join(" | "),
      fix: "Inspect semantic_report and harden assertions around expected motion/state changes."
    });
  } else if (Array.isArray(semantics.right) && semantics.right.length > 0) {
    strengths.push("Semantic checks were satisfied.");
  }

  const waitStep = (run.steps || []).find((s) => String(s.action || "").toLowerCase() === "wait");
  if (!waitStep) {
    issues.push({
      id: "insufficient_observation_window",
      severity: "medium",
      description: "No dedicated wait/observation window detected.",
      evidence: "A wait step is missing from executed sequence.",
      fix: "Include a wait step (>= 10 seconds) before post-observation assertions."
    });
  } else {
    strengths.push("Observed timeline includes an explicit wait window.");
  }

  const summaryText = String(run.summary || "");
  const staticSignals = /(timeout|not found|unsupported|failed)/i.test(summaryText);
  if (staticSignals) {
    issues.push({
      id: "execution_instability",
      severity: "high",
      description: "Execution output indicates instability or selector mismatch.",
      evidence: summaryText,
      fix: "Use resilient selectors and fallback observation-only plan when controls are absent."
    });
  }

  const expected = input.objective || "Validate expected feature behavior";
  const observed = run.status === "pass" ? "Run completed with evidence artifacts." : "Run failed; evidence indicates unmet expectations.";

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const highCount = issues.filter((i) => i.severity === "high").length;
  const mediumCount = issues.filter((i) => i.severity === "medium").length;
  const readinessScore = Math.max(0, 100 - criticalCount * 40 - highCount * 20 - mediumCount * 10);

  return {
    verdict: issues.some((i) => i.severity === "critical" || i.severity === "high") ? "fail" : "pass",
    confidence: issues.length === 0 ? 0.9 : 0.7,
    summary:
      issues.length === 0
        ? "Critic found no blocking semantic regressions."
        : `Critic detected ${issues.length} issue(s) requiring attention.`,
    expectedVsObserved: {
      expected,
      observed
    },
    strengths,
    issues,
    readinessScore,
    generatedAt: new Date().toISOString()
  };
}

async function langChainCritique(input, deterministic) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const { ChatOpenAI } = await import("@langchain/openai");
    const { ChatPromptTemplate } = await import("@langchain/core/prompts");

    const model = new ChatOpenAI({
      apiKey,
      model: "gpt-4o-mini",
      temperature: 0.1
    });

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are an aggressive QA critic. Return strict JSON with keys: verdict, confidence, summary, strengths(array), issues(array of {id,severity,description,evidence,fix}), expectedVsObserved(object with expected/observed), readinessScore(number)."
      ],
      [
        "human",
        `Objective:\n${input.objective || ""}\n\nProcedure:\n${JSON.stringify(input.procedure || {}, null, 2)}\n\nRun:\n${JSON.stringify(input.run || {}, null, 2)}\n\nDeterministic Critique Baseline:\n${JSON.stringify(deterministic, null, 2)}`
      ]
    ]);

    const chain = prompt.pipe(model);
    const response = await chain.invoke({});
    const content = String(response.content || "");
    const block = content.match(/```json\s*([\s\S]*?)```/i);
    const parsed = JSON.parse((block ? block[1] : content).trim());
    return parsed;
  } catch (_) {
    return null;
  }
}

class RunCriticAgent {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  async analyze(input) {
    const baseline = deterministicCritique(input);
    const llm = await langChainCritique(input, baseline);
    if (!llm || typeof llm !== "object") {
      return { ...baseline, source: "deterministic" };
    }

    return {
      verdict: llm.verdict || baseline.verdict,
      confidence: typeof llm.confidence === "number" ? llm.confidence : baseline.confidence,
      summary: llm.summary || baseline.summary,
      expectedVsObserved: llm.expectedVsObserved || baseline.expectedVsObserved,
      strengths: Array.isArray(llm.strengths) ? llm.strengths : baseline.strengths,
      issues: Array.isArray(llm.issues) ? llm.issues : baseline.issues,
      readinessScore: typeof llm.readinessScore === "number" ? llm.readinessScore : baseline.readinessScore,
      generatedAt: new Date().toISOString(),
      source: "langchain"
    };
  }
}

module.exports = {
  RunCriticAgent
};

