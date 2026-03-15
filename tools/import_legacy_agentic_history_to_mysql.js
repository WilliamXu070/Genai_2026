const fs = require("node:fs");
const path = require("node:path");
const { AgenticMySqlPersistenceService, ensureSummaryArray } = require("../src/runtime/agentic_mysql_persistence");
const { getPool } = require("../src/db/mysql_agentic_client");

function loadLegacyStore(projectRoot) {
  const storePath = path.join(projectRoot, "db", "agentic.json");
  if (!fs.existsSync(storePath)) {
    throw new Error(`Legacy agentic store not found: ${storePath}`);
  }
  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

function toMySqlDateTime(value) {
  const date = new Date(value || Date.now());
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function normalizeRunStatus(status) {
  return String(status || "").toLowerCase() === "pass" ? "passed" : "failed";
}

function normalizeLoopStatus(status) {
  return String(status || "").toLowerCase() === "pass" ? "passed" : "failed";
}

function buildSummary(run) {
  const summary = [];
  if (run?.summary) {
    summary.push(String(run.summary));
  }

  const defects = Array.isArray(run?.critique?.defects)
    ? run.critique.defects
    : Array.isArray(run?.critique?.issues)
      ? run.critique.issues
      : [];
  defects.slice(0, 2).forEach((defect) => {
    if (defect?.description) {
      summary.push(String(defect.description));
    }
  });

  if (summary.length < 3 && run?.semantics?.verdict) {
    summary.push(`Semantic verdict: ${run.semantics.verdict}`);
  }

  return ensureSummaryArray(summary);
}

function buildLoopArtifacts(run) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const refs = artifacts.map((artifact) => ({
    type: artifact?.type || "artifact",
    path: artifact?.path || ""
  }));

  return {
    screenshot_refs: refs.filter((item) => /\.png$/i.test(item.path)).map((item) => item.path),
    console_errors: run?.status === "pass" ? [] : [run?.summary || "Legacy run failure"],
    video_chunk_refs: refs.filter((item) => /\.(webm|mp4)$/i.test(item.path)).map((item) => item.path),
    critic_output: run?.critique || null,
    structured_metrics: {
      semantics: run?.semantics || null,
      imported_from: "db/agentic.json"
    },
    artifact_refs: refs
  };
}

function buildTestingInstructions(forest, tree) {
  return [
    forest?.objective || "",
    tree?.procedure?.summary || "",
    tree?.procedure?.notes || ""
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const store = loadLegacyStore(projectRoot);
  const service = new AgenticMySqlPersistenceService();
  if (!service.isEnabled()) {
    throw new Error(`MySQL persistence is disabled: ${service.disabledReason}`);
  }
  await service.ping();

  const pool = getPool();
  const forestsById = new Map((store.forests || []).map((forest) => [forest.forestId, forest]));
  let importedRuns = 0;

  for (const run of store.runs || []) {
    const forest = forestsById.get(run.forestId) || null;
    const tree = forest?.trees?.find((item) => item.treeId === run.treeId) || null;
    const project = await service.getOrCreateProjectByName(forest?.projectName || "Jungle");
    const runStatus = normalizeRunStatus(run.status);
    const instructions = buildTestingInstructions(forest, tree);
    const summary = buildSummary(run);
    const createdAt = toMySqlDateTime(run.createdAt);
    const updatedAt = toMySqlDateTime(run.createdAt);

    await pool.query(
      `INSERT INTO test_runs
        (id, project_id, execution_time_ms, loop_count, status, testing_instructions, video_reference, three_point_summary_json, last_error_text, created_at, updated_at)
       VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        project_id = VALUES(project_id),
        loop_count = VALUES(loop_count),
        status = VALUES(status),
        testing_instructions = VALUES(testing_instructions),
        video_reference = VALUES(video_reference),
        three_point_summary_json = VALUES(three_point_summary_json),
        last_error_text = VALUES(last_error_text),
        updated_at = VALUES(updated_at)`,
      [
        run.runId,
        project.id,
        runStatus,
        instructions,
        run.videoPath || null,
        JSON.stringify(summary),
        runStatus === "passed" ? null : run.summary || null,
        createdAt,
        updatedAt
      ]
    );

    await pool.query(
      `INSERT INTO loop_iterations
        (test_run_id, loop_number, status, step_summary, artifacts_json, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        step_summary = VALUES(step_summary),
        artifacts_json = VALUES(artifacts_json),
        updated_at = VALUES(updated_at)`,
      [
        run.runId,
        normalizeLoopStatus(run.status),
        run.summary || null,
        JSON.stringify(buildLoopArtifacts(run)),
        createdAt,
        updatedAt
      ]
    );

    importedRuns += 1;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        importedRuns,
        importedProjects: Array.from(new Set((store.forests || []).map((forest) => forest.projectName || "Jungle"))).length
      },
      null,
      2
    )}\n`
  );
}

main()
  .then(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  })
  .catch(async (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    const pool = getPool();
    if (pool) {
      try {
        await pool.end();
      } catch (_) {
        // ignore pool shutdown failures during error handling
      }
    }
    process.exit(1);
  });
