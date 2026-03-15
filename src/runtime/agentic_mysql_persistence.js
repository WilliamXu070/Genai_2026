const { getClientStatus, getPool, withTransaction } = require("../db/mysql_agentic_client");

const RUN_STATUSES = [
  "drafting",
  "to_be_approved",
  "approved",
  "in_progress",
  "passed",
  "failed",
  "max_loops_reached",
  "cancelled"
];
const LOOP_STATUSES = ["running", "passed", "failed"];
const VALID_STATUS_TRANSITIONS = {
  drafting: new Set(["to_be_approved", "failed", "cancelled"]),
  to_be_approved: new Set(["approved", "failed", "cancelled"]),
  approved: new Set(["in_progress", "cancelled"]),
  in_progress: new Set(["in_progress", "passed", "failed", "max_loops_reached", "cancelled"]),
  passed: new Set(),
  failed: new Set(),
  max_loops_reached: new Set(),
  cancelled: new Set(["cancelled"])
};
const RUN_SELECT = `SELECT
  tr.id,
  tr.project_id AS projectId,
  p.name AS projectName,
  tr.execution_time_ms AS executionTimeMs,
  tr.loop_count AS loopCount,
  tr.status,
  tr.testing_instructions AS testingInstructions,
  tr.video_reference AS videoReference,
  tr.three_point_summary_json AS threePointSummary,
  tr.last_error_text AS lastErrorText,
  tr.approval_requested_at AS approvalRequestedAt,
  tr.approved_at AS approvedAt,
  tr.approved_by AS approvedBy,
  tr.cancelled_at AS cancelledAt,
  tr.draft_payload_json AS draftPayload,
  tr.created_at AS createdAt,
  tr.updated_at AS updatedAt
FROM test_runs tr
INNER JOIN projects p ON p.id = tr.project_id`;

function ensureSummaryArray(input) {
  const list = Array.isArray(input) ? input.filter((item) => typeof item === "string" && item.trim()) : [];
  return [
    list[0] || "No key finding recorded.",
    list[1] || "No secondary finding recorded.",
    list[2] || "No tertiary finding recorded."
  ];
}

function slugifyProject(name) {
  const base = String(name || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (base || "project").slice(0, 48);
}

function buildRunId() {
  const entropy = Math.random().toString(36).slice(2, 8);
  return `test_run_${Date.now()}_${entropy}`;
}

function parseJsonValue(input, fallback) {
  if (input === null || input === undefined || input === "") {
    return fallback;
  }
  if (Buffer.isBuffer(input)) {
    return parseJsonValue(input.toString("utf8"), fallback);
  }
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch (_) {
      return fallback;
    }
  }
  return input;
}

function ensureRunStatus(status, fallback = "failed") {
  return RUN_STATUSES.includes(status) ? status : fallback;
}

function ensureLoopStatus(status) {
  return LOOP_STATUSES.includes(status) ? status : "failed";
}

function canTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) {
    return false;
  }
  if (fromStatus === toStatus) {
    return true;
  }
  return VALID_STATUS_TRANSITIONS[fromStatus]?.has(toStatus) || false;
}

function ensureTransition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`Invalid test run status transition: ${fromStatus || "unknown"} -> ${toStatus || "unknown"}`);
  }
}

function mapRunRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    executionTimeMs: row.executionTimeMs === null || row.executionTimeMs === undefined ? null : Number(row.executionTimeMs),
    loopCount: Number(row.loopCount || 0),
    threePointSummary: ensureSummaryArray(parseJsonValue(row.threePointSummary, [])),
    draftPayload: parseJsonValue(row.draftPayload, null)
  };
}

function mapLoopRow(row) {
  return {
    ...row,
    loopNumber: Number(row.loopNumber || 0),
    artifacts: parseJsonValue(row.artifacts, {})
  };
}

async function fetchRunRecord(executor, runId, options = {}) {
  const suffix = options.forUpdate ? " FOR UPDATE" : "";
  const [rows] = await executor.query(`${RUN_SELECT} WHERE tr.id = ? LIMIT 1${suffix}`, [runId]);
  return mapRunRow(rows[0] || null);
}

async function touchProject(executor, projectId) {
  if (!projectId) {
    return;
  }
  await executor.query("UPDATE projects SET updated_at = NOW() WHERE id = ?", [projectId]);
}

function buildStatusWhereClause(statuses) {
  const validStatuses = statuses.filter((status) => RUN_STATUSES.includes(status));
  if (validStatuses.length === 0) {
    return { sql: "1 = 0", params: [] };
  }
  const placeholders = validStatuses.map(() => "?").join(", ");
  return {
    sql: `tr.status IN (${placeholders})`,
    params: validStatuses
  };
}

function withApprovalInstructionMetadata(run, nextInstructions, actor) {
  const base = run?.draftPayload && typeof run.draftPayload === "object" ? { ...run.draftPayload } : {};
  return {
    ...base,
    approvedTestingInstructions: nextInstructions,
    approvalInstructionEditedAt: new Date().toISOString(),
    approvalInstructionEditedBy: actor || null
  };
}

function withPreservedApprovalMetadata(run, nextDraftPayload) {
  const existing = run?.draftPayload && typeof run.draftPayload === "object" ? run.draftPayload : {};
  if (!existing.approvalInstructionEditedAt) {
    return nextDraftPayload;
  }

  const base = nextDraftPayload && typeof nextDraftPayload === "object" ? { ...nextDraftPayload } : {};
  if (!base.approvalInstructionEditedAt) {
    base.approvalInstructionEditedAt = existing.approvalInstructionEditedAt;
  }
  if (!base.approvalInstructionEditedBy) {
    base.approvalInstructionEditedBy = existing.approvalInstructionEditedBy || null;
  }
  if (!base.approvedTestingInstructions) {
    base.approvedTestingInstructions = existing.approvedTestingInstructions || run.testingInstructions || "";
  }
  return base;
}

class AgenticMySqlPersistenceService {
  constructor() {
    this.status = getClientStatus();
    this.disabledReason = this.status.enabled ? "" : this.status.reason;
  }

  isEnabled() {
    return this.status.enabled;
  }

  async ping() {
    if (!this.isEnabled()) {
      return false;
    }
    const pool = getPool();
    await pool.query("SELECT 1");
    return true;
  }

  async getOrCreateProjectByName(projectName) {
    if (!this.isEnabled()) {
      return null;
    }

    const pool = getPool();
    const canonical = (projectName || "Jungle").trim() || "Jungle";
    const [existing] = await pool.query(
      "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE name = ? LIMIT 1",
      [canonical]
    );
    if (existing.length > 0) {
      return existing[0];
    }

    const projectId = `${slugifyProject(canonical)}_${Date.now()}`.slice(0, 64);
    await pool.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())", [
      projectId,
      canonical
    ]);

    const [rows] = await pool.query(
      "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ? LIMIT 1",
      [projectId]
    );
    return rows[0] || null;
  }

  async createDraftingRun(input) {
    if (!this.isEnabled()) {
      return null;
    }

    const pool = getPool();
    const runId = buildRunId();
    await pool.query(
      `INSERT INTO test_runs
        (id, project_id, execution_time_ms, loop_count, status, testing_instructions, video_reference, three_point_summary_json, last_error_text, approval_requested_at, approved_at, approved_by, cancelled_at, draft_payload_json, created_at, updated_at)
       VALUES (?, ?, NULL, 0, 'drafting', ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, NOW(), NOW())`,
      [
        runId,
        input.projectId,
        input.testingInstructions || "",
        JSON.stringify(ensureSummaryArray(input.threePointSummary)),
        input.draftPayload ? JSON.stringify(input.draftPayload) : null
      ]
    );
    await touchProject(pool, input.projectId);
    return this.getRunRecord(runId);
  }

  async markRunAwaitingApproval(input) {
    if (!this.isEnabled() || !input?.testRunId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.testRunId, { forUpdate: true });
      if (!run) {
        return null;
      }
      ensureTransition(run.status, "to_be_approved");
      await conn.query(
        `UPDATE test_runs
         SET status = 'to_be_approved',
             testing_instructions = ?,
             three_point_summary_json = ?,
             draft_payload_json = ?,
             approval_requested_at = COALESCE(approval_requested_at, NOW()),
             updated_at = NOW()
         WHERE id = ?`,
        [
          input.testingInstructions || run.testingInstructions || "",
          JSON.stringify(ensureSummaryArray(input.threePointSummary)),
          input.draftPayload ? JSON.stringify(input.draftPayload) : null,
          input.testRunId
        ]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.testRunId);
    });
  }

  async markRunFailedDuringDraft(input) {
    if (!this.isEnabled() || !input?.testRunId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.testRunId, { forUpdate: true });
      if (!run) {
        return null;
      }
      if (run.status === "cancelled") {
        return run;
      }
      ensureTransition(run.status, "failed");
      await conn.query(
        `UPDATE test_runs
         SET status = 'failed',
             three_point_summary_json = ?,
             last_error_text = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          JSON.stringify(ensureSummaryArray(input.threePointSummary)),
          input.lastErrorText || "Draft creation failed",
          input.testRunId
        ]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.testRunId);
    });
  }

  async approveRun(input) {
    if (!this.isEnabled() || !input?.runId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.runId, { forUpdate: true });
      if (!run) {
        return null;
      }
      if (run.status === "approved" || run.status === "in_progress") {
        return run;
      }
      ensureTransition(run.status, "approved");
      const hasTestingInstructionsOverride = typeof input.testingInstructions === "string";
      const nextTestingInstructions = hasTestingInstructionsOverride
        ? input.testingInstructions
        : run.testingInstructions || "";
      const nextDraftPayload = hasTestingInstructionsOverride
        ? withApprovalInstructionMetadata(run, nextTestingInstructions, input.approvedBy)
        : run.draftPayload;
      await conn.query(
        `UPDATE test_runs
         SET status = 'approved',
             testing_instructions = ?,
             draft_payload_json = ?,
             approved_at = COALESCE(approved_at, NOW()),
             approved_by = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          nextTestingInstructions,
          nextDraftPayload ? JSON.stringify(nextDraftPayload) : null,
          input.approvedBy || null,
          input.runId
        ]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.runId);
    });
  }

  async updateRunTestingInstructions(input) {
    if (!this.isEnabled() || !input?.runId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.runId, { forUpdate: true });
      if (!run) {
        return null;
      }
      if (run.status !== "to_be_approved") {
        throw new Error(`Run ${input.runId} is not editable in status ${run.status}`);
      }

      const nextTestingInstructions =
        typeof input.testingInstructions === "string" ? input.testingInstructions : run.testingInstructions || "";
      const nextDraftPayload = withApprovalInstructionMetadata(run, nextTestingInstructions, input.editedBy);

      await conn.query(
        `UPDATE test_runs
         SET testing_instructions = ?,
             draft_payload_json = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [nextTestingInstructions, JSON.stringify(nextDraftPayload), input.runId]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.runId);
    });
  }

  async cancelRun(input) {
    if (!this.isEnabled() || !input?.runId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.runId, { forUpdate: true });
      if (!run) {
        return null;
      }
      if (run.status === "cancelled") {
        return run;
      }
      ensureTransition(run.status, "cancelled");
      await conn.query(
        `UPDATE test_runs
         SET status = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, NOW()),
             last_error_text = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [input.reason || "Run cancelled by user.", input.runId]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.runId);
    });
  }

  async claimApprovedRunForExecution(runId) {
    if (!this.isEnabled() || !runId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const [result] = await conn.query(
        "UPDATE test_runs SET status = 'in_progress', updated_at = NOW() WHERE id = ? AND status = 'approved'",
        [runId]
      );
      if (Number(result.affectedRows || 0) === 0) {
        return null;
      }
      const run = await fetchRunRecord(conn, runId);
      await touchProject(conn, run?.projectId);
      return run;
    });
  }

  async updateRunDraftPayload(input) {
    if (!this.isEnabled() || !input?.testRunId) {
      return null;
    }

    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.testRunId, { forUpdate: true });
      if (!run) {
        return null;
      }
      const approvedInstructionsLocked = Boolean(run?.draftPayload?.approvalInstructionEditedAt);
      const nextTestingInstructions = approvedInstructionsLocked
        ? run.testingInstructions || ""
        : input.testingInstructions || run.testingInstructions || "";
      const nextDraftPayload = withPreservedApprovalMetadata(
        run,
        input.draftPayload ? { ...input.draftPayload } : null
      );
      await conn.query(
        `UPDATE test_runs
         SET testing_instructions = ?,
             three_point_summary_json = ?,
             draft_payload_json = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          nextTestingInstructions,
          JSON.stringify(ensureSummaryArray(input.threePointSummary)),
          nextDraftPayload ? JSON.stringify(nextDraftPayload) : null,
          input.testRunId
        ]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.testRunId);
    });
  }

  async listRunsByStatuses(statuses, options = {}) {
    if (!this.isEnabled()) {
      return [];
    }

    const pool = getPool();
    const where = buildStatusWhereClause(Array.isArray(statuses) ? statuses : []);
    const params = [...where.params];
    const filters = [where.sql];

    if (options.projectId) {
      filters.push("tr.project_id = ?");
      params.push(options.projectId);
    }

    let sql = `${RUN_SELECT} WHERE ${filters.join(" AND ")} ORDER BY tr.updated_at DESC, tr.created_at DESC`;
    if (Number.isFinite(options.limit) && options.limit > 0) {
      sql += " LIMIT ?";
      params.push(Number(options.limit));
    }

    const [rows] = await pool.query(sql, params);
    return rows.map(mapRunRow);
  }

  async listAwaitingApprovalRuns(projectId = null) {
    return this.listRunsByStatuses(["to_be_approved"], { projectId });
  }

  async listInProgressRuns(projectId = null) {
    return this.listRunsByStatuses(["drafting", "approved", "in_progress"], { projectId });
  }

  async listProjects() {
    if (!this.isEnabled()) {
      return [];
    }

    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC"
    );
    return rows;
  }

  async listTestRunsByProject(projectId) {
    if (!projectId) {
      return [];
    }
    return this.listRunsByStatuses(RUN_STATUSES, { projectId });
  }

  async getRunRecord(runId) {
    if (!this.isEnabled() || !runId) {
      return null;
    }

    const pool = getPool();
    return fetchRunRecord(pool, runId);
  }

  async getRunStatus(runId) {
    if (!this.isEnabled() || !runId) {
      return null;
    }

    const pool = getPool();
    const [rows] = await pool.query("SELECT status FROM test_runs WHERE id = ? LIMIT 1", [runId]);
    return rows[0]?.status || null;
  }

  async getLoopCount(runId) {
    if (!this.isEnabled() || !runId) {
      return 0;
    }

    const pool = getPool();
    const [rows] = await pool.query("SELECT loop_count AS loopCount FROM test_runs WHERE id = ? LIMIT 1", [runId]);
    return Number(rows[0]?.loopCount || 0);
  }

  async persistLoopAndRunState(input) {
    if (!this.isEnabled() || !input?.testRunId) {
      return null;
    }

    const loopNumber = Number(input.loopNumber || 0);
    const runStatus = ensureRunStatus(input.runStatus, "in_progress");
    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.testRunId, { forUpdate: true });
      if (!run) {
        return null;
      }
      if (run.status === "cancelled") {
        return run;
      }
      ensureTransition(run.status, runStatus);

      await conn.query(
        `INSERT INTO loop_iterations
          (test_run_id, loop_number, status, step_summary, artifacts_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          step_summary = VALUES(step_summary),
          artifacts_json = VALUES(artifacts_json),
          updated_at = NOW()`,
        [
          input.testRunId,
          loopNumber,
          ensureLoopStatus(input.loopStatus),
          input.stepSummary || null,
          JSON.stringify(input.artifacts || {})
        ]
      );

      await conn.query(
        `UPDATE test_runs
         SET loop_count = ?,
             status = ?,
             last_error_text = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [loopNumber, runStatus, input.lastErrorText || null, input.testRunId]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.testRunId);
    });
  }

  async finalizeRun(input) {
    if (!this.isEnabled() || !input?.testRunId) {
      return null;
    }

    const targetStatus = ensureRunStatus(input.status);
    return withTransaction(async (conn) => {
      const run = await fetchRunRecord(conn, input.testRunId, { forUpdate: true });
      if (!run) {
        return null;
      }
      if (run.status === "cancelled" && targetStatus !== "cancelled") {
        return run;
      }
      ensureTransition(run.status, targetStatus);
      await conn.query(
        `UPDATE test_runs
         SET execution_time_ms = ?,
             loop_count = ?,
             status = ?,
             testing_instructions = ?,
             video_reference = ?,
             three_point_summary_json = ?,
             last_error_text = ?,
             cancelled_at = CASE WHEN ? = 'cancelled' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END,
             updated_at = NOW()
         WHERE id = ?`,
        [
          Number.isFinite(input.executionTimeMs) ? Number(input.executionTimeMs) : null,
          Number(input.loopCount || 0),
          targetStatus,
          input.testingInstructions || run.testingInstructions || "",
          input.videoReference || null,
          JSON.stringify(ensureSummaryArray(input.threePointSummary)),
          input.lastErrorText || null,
          targetStatus,
          input.testRunId
        ]
      );
      await touchProject(conn, run.projectId);
      return fetchRunRecord(conn, input.testRunId);
    });
  }

  async getTestRunDetail(runId) {
    if (!this.isEnabled() || !runId) {
      return null;
    }

    const pool = getPool();
    const run = await fetchRunRecord(pool, runId);
    if (!run) {
      return null;
    }

    const [loops] = await pool.query(
      `SELECT
        id,
        test_run_id AS testRunId,
        loop_number AS loopNumber,
        status,
        step_summary AS stepSummary,
        artifacts_json AS artifacts,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM loop_iterations
       WHERE test_run_id = ?
       ORDER BY loop_number ASC`,
      [runId]
    );

    return {
      ...run,
      loopIterations: loops.map(mapLoopRow)
    };
  }
}

module.exports = {
  AgenticMySqlPersistenceService,
  ensureSummaryArray
};
