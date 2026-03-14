const fs = require("node:fs");
const path = require("node:path");
const { CatalogService } = require("../src/catalog/service");

function toSqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${text}'`;
}

function isoToMysqlDateTime(value) {
  const date = new Date(value || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const outPath = path.join(projectRoot, "db", "mysql", "002-test-catalog-seed.sql");

  const service = new CatalogService(projectRoot);
  service.ensureLoaded();
  const state = service.state;
  const now = isoToMysqlDateTime(new Date().toISOString());
  const lines = [];

  lines.push("USE jungle_catalog;");
  lines.push("DELETE FROM test_artifacts;");
  lines.push("DELETE FROM test_runs;");
  lines.push("DELETE FROM test_versions;");
  lines.push("DELETE FROM tests;");
  lines.push("DELETE FROM projects;");
  lines.push(
    `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('genai_2026', 'Genai_2026', '${now}', '${now}');`
  );

  state.tests.forEach((test) => {
    lines.push(
      `INSERT INTO tests (id, project_id, title, objective, status, latest_version, created_at, updated_at) VALUES (${toSqlString(
        test.id
      )}, 'genai_2026', ${toSqlString(test.title)}, ${toSqlString(test.objective)}, ${toSqlString(
        test.status
      )}, ${Number(test.latestVersion || 1)}, ${toSqlString(isoToMysqlDateTime(test.createdAt))}, ${toSqlString(
        isoToMysqlDateTime(test.updatedAt)
      )});`
    );

    test.versions.forEach((version) => {
      lines.push(
        `INSERT INTO test_versions (id, test_id, version_number, objective, notes, status, source_type, plan_json, created_at) VALUES (${toSqlString(
          version.id
        )}, ${toSqlString(test.id)}, ${Number(version.number || 1)}, ${toSqlString(version.objective)}, ${toSqlString(
          version.notes || ""
        )}, ${toSqlString(version.status)}, ${toSqlString(version.sourceType)}, ${toSqlString(
          JSON.stringify(version.plan || {})
        )}, ${toSqlString(isoToMysqlDateTime(version.createdAt))});`
      );
    });

    test.runs.forEach((run) => {
      lines.push(
        `INSERT INTO test_runs (id, test_id, status, summary, video_path, source_file, created_at) VALUES (${toSqlString(
          run.id
        )}, ${toSqlString(test.id)}, ${toSqlString(run.status)}, ${toSqlString(run.summary || "")}, ${toSqlString(
          run.videoPath || ""
        )}, ${toSqlString(run.sourceFile || "")}, ${toSqlString(isoToMysqlDateTime(run.createdAt))});`
      );

      (run.artifacts || []).forEach((artifactPath) => {
        lines.push(
          `INSERT INTO test_artifacts (run_id, artifact_path) VALUES (${toSqlString(run.id)}, ${toSqlString(
            artifactPath
          )});`
        );
      });
    });
  });

  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`Generated ${outPath}\n`);
}

main();

