const {
  selectData,
  insertData,
  updateData,
  updateSchema,
  runInTransaction,
} = require("../config/database");
const Notification = require("./Notification");
const Workflow = require("./ApplicationWorkflow");
const Contract = require("./Contract");
const Assessment = require("./AssessmentEvaluation");

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Header lifecycle for an application's trip through the approving hierarchy. */
const APPROVAL_STATUSES = ["PENDING", "IN_PROGRESS", "APPROVED", "DISAPPROVED", "RETURNED"];
/** Per-level outcomes on the routing ladder. */
const STEP_DECISIONS = ["PENDING", "APPROVED", "DISAPPROVED", "RETURNED", "SKIPPED"];
/** Actions an approver can take on the level currently sitting with them. */
const STEP_ACTIONS = ["APPROVE", "DISAPPROVE", "RETURN", "ENDORSE"];
const ISSUANCE_TYPES = ["APPROVAL_ORDER", "NOTICE_OF_AWARD", "CONTRACT", "PERMIT", "OTHER"];

const DEFAULT_LEVELS = [
  { level_no: 1, name: "Account Officer Review", role_hint: "Account Officer" },
  { level_no: 2, name: "Division Chief Endorsement", role_hint: "Division Chief" },
  { level_no: 3, name: "Approving Authority", role_hint: "Manager / Department Head" },
];

function pick(value, allowed, fallback = null) {
  const v = String(value ?? "").trim().toUpperCase();
  return allowed.includes(v) ? v : fallback;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.approval_levels', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.approval_levels (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        level_no INT NOT NULL,
        name NVARCHAR(150) NOT NULL,
        role_hint NVARCHAR(120) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_approval_levels_is_active DEFAULT (1),
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_approval_levels_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_approval_levels_level_no ON dbo.approval_levels(level_no);
    END;

    IF OBJECT_ID('dbo.application_approvals', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_approvals (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_application_approvals_status DEFAULT ('PENDING'),
        current_level_no INT NULL,
        decision NVARCHAR(20) NULL,
        decision_summary NVARCHAR(2000) NULL,
        decided_by INT NULL,
        decided_at DATETIME2(3) NULL,
        started_by INT NULL,
        started_at DATETIME2(3) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_application_approvals_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE UNIQUE INDEX UX_application_approvals_application_id ON dbo.application_approvals(application_id);
      CREATE INDEX IX_application_approvals_status ON dbo.application_approvals(status);
    END;

    IF OBJECT_ID('dbo.approval_steps', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.approval_steps (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        approval_id INT NOT NULL,
        level_no INT NOT NULL,
        level_name NVARCHAR(150) NOT NULL,
        assigned_to INT NULL,
        decision NVARCHAR(20) NOT NULL CONSTRAINT DF_approval_steps_decision DEFAULT ('PENDING'),
        action NVARCHAR(20) NULL,
        endorsed_to_office NVARCHAR(150) NULL,
        remarks NVARCHAR(2000) NULL,
        acted_by INT NULL,
        acted_at DATETIME2(3) NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_approval_steps_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_approval_steps_approval_id ON dbo.approval_steps(approval_id);
    END;

    IF OBJECT_ID('dbo.approval_issuances', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.approval_issuances (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        approval_id INT NOT NULL,
        application_id INT NOT NULL,
        doc_type NVARCHAR(30) NOT NULL CONSTRAINT DF_approval_issuances_doc_type DEFAULT ('APPROVAL_ORDER'),
        reference_no NVARCHAR(120) NULL,
        title NVARCHAR(200) NOT NULL,
        issued_date DATETIME2(3) NULL,
        document_id INT NULL,
        notes NVARCHAR(2000) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_approval_issuances_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_approval_issuances_approval_id ON dbo.approval_issuances(approval_id);
    END;

    IF OBJECT_ID('dbo.approval_activity', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.approval_activity (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        approval_id INT NOT NULL,
        action NVARCHAR(40) NOT NULL,
        detail NVARCHAR(1000) NULL,
        actor_id INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_approval_activity_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_approval_activity_approval_id ON dbo.approval_activity(approval_id);
    END;
  `);

  // The queue LEFT JOINs application_assessments (assessment endorses into the
  // approval workflow); make sure that table exists even on a DB where the
  // assessment module was never opened.
  try {
    await Assessment.ensureSchema();
  } catch (error) {
    console.error("Approval ensureSchema: assessment schema check failed:", error);
  }

  const existing = await selectData(`SELECT COUNT(1) AS total FROM dbo.approval_levels`);
  if (Number(existing?.[0]?.total || 0) === 0) {
    for (const lvl of DEFAULT_LEVELS) {
      await insertData(
        `INSERT INTO dbo.approval_levels (level_no, name, role_hint, is_active, created_at)
         VALUES (@param0, @param1, @param2, 1, SYSUTCDATETIME())`,
        [lvl.level_no, lvl.name, lvl.role_hint]
      );
    }
  }
}

async function logActivity(approvalId, action, detail, actorId) {
  try {
    await insertData(
      `INSERT INTO dbo.approval_activity (approval_id, action, detail, actor_id, created_at)
       VALUES (@param0, @param1, @param2, @param3, SYSUTCDATETIME())`,
      [toInt(approvalId), String(action).slice(0, 40), detail ? String(detail).slice(0, 1000) : null, toInt(actorId)]
    );
  } catch (error) {
    console.error("Log approval activity error:", error);
  }
}

async function notify({ applicationId, actorId, subject, body }) {
  try {
    await Notification.createApplicationScopedNotifications({
      applicationId,
      actorId,
      eventType: "approval",
      subject,
      body,
    });
  } catch (error) {
    console.error("Approval notification error:", error);
  }
}

async function getApplicationRow(applicationId) {
  const rows = await selectData(
    `SELECT TOP (1) a.id, a.application_no, a.application_type, a.is_renewal, a.status, a.proponent_id
     FROM dbo.applications a WHERE a.id = @param0`,
    [toInt(applicationId)]
  );
  return rows?.[0] || null;
}

/* --------------------------- Configurable levels --------------------------- */

async function listLevels({ includeInactive = false } = {}) {
  await ensureSchema();
  return selectData(
    `SELECT id, level_no, name, role_hint, is_active, created_at, updated_at
     FROM dbo.approval_levels
     ${includeInactive ? "" : "WHERE is_active = 1"}
     ORDER BY level_no ASC, id ASC`
  );
}

async function getLevelById(id) {
  const rows = await selectData(`SELECT * FROM dbo.approval_levels WHERE id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

async function createLevel({ level_no, name, role_hint, actorId }) {
  await ensureSchema();
  const label = String(name ?? "").trim();
  if (!label) throw new Error("name is required");
  let lvl = toInt(level_no);
  if (lvl === null) {
    const maxRows = await selectData(`SELECT ISNULL(MAX(level_no), 0) AS max_no FROM dbo.approval_levels`);
    lvl = Number(maxRows?.[0]?.max_no || 0) + 1;
  }
  const result = await insertData(
    `INSERT INTO dbo.approval_levels (level_no, name, role_hint, is_active, created_by, created_at)
     OUTPUT INSERTED.id
     VALUES (@param0, @param1, @param2, 1, @param3, SYSUTCDATETIME())`,
    [lvl, label.slice(0, 150), role_hint ? String(role_hint).slice(0, 120) : null, toInt(actorId)]
  );
  return getLevelById(result?.recordset?.[0]?.id);
}

async function updateLevel(id, payload, actorId) {
  await ensureSchema();
  const existing = await getLevelById(id);
  if (!existing) return null;
  const sets = [];
  const params = [];
  const push = (frag, value) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (payload?.level_no !== undefined) push("level_no = ?", toInt(payload.level_no) ?? existing.level_no);
  if (payload?.name !== undefined) {
    const label = String(payload.name ?? "").trim();
    if (!label) throw new Error("name cannot be empty");
    push("name = ?", label.slice(0, 150));
  }
  if (payload?.role_hint !== undefined) push("role_hint = ?", payload.role_hint ? String(payload.role_hint).slice(0, 120) : null);
  if (payload?.is_active !== undefined) push("is_active = ?", payload.is_active ? 1 : 0);
  push("updated_by = ?", toInt(actorId));
  params.push(toInt(id));
  await updateData(
    `UPDATE dbo.approval_levels SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length - 1}`,
    params
  );
  return getLevelById(id);
}

async function deleteLevel(id, actorId) {
  await ensureSchema();
  const existing = await getLevelById(id);
  if (!existing) return false;
  // Soft-disable so historical approval_steps snapshots stay meaningful.
  await updateData(
    `UPDATE dbo.approval_levels SET is_active = 0, updated_by = @param1, updated_at = SYSUTCDATETIME() WHERE id = @param0`,
    [toInt(id), toInt(actorId)]
  );
  return true;
}

/* ------------------------------ Approval header ---------------------------- */

const LIST_SELECT = `
  SELECT
    a.id AS application_id,
    a.application_no,
    a.application_type,
    a.is_renewal,
    a.status AS application_status,
    a.proponent_id,
    p.business_name AS proponent_name,
    a.submitted_at,
    ap.id AS approval_id,
    ISNULL(ap.status, 'PENDING') AS approval_status,
    ap.current_level_no,
    ap.decision,
    ap.decision_summary,
    ap.decided_at,
    asm.recommendation AS assessment_recommendation,
    ISNULL(asm.charges_total, 0) AS charges_total,
    CASE WHEN ap.started_at IS NULL THEN NULL
      ELSE DATEDIFF(DAY, ap.started_at, SYSUTCDATETIME()) END AS days_in_approval,
    (SELECT COUNT(1) FROM dbo.approval_steps s WHERE s.approval_id = ap.id) AS total_steps,
    (SELECT COUNT(1) FROM dbo.approval_steps s WHERE s.approval_id = ap.id AND s.decision = 'APPROVED') AS approved_steps,
    (SELECT COUNT(1) FROM dbo.approval_issuances i WHERE i.approval_id = ap.id) AS issuance_count,
    cur.level_name AS current_level_name,
    cu.full_name AS current_assignee_name,
    cu.username AS current_assignee_username
  FROM dbo.applications a
  LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
  LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id
  LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
  OUTER APPLY (
    SELECT TOP (1) s.level_name, s.assigned_to
    FROM dbo.approval_steps s
    WHERE s.approval_id = ap.id AND s.decision = 'PENDING'
    ORDER BY s.level_no ASC, s.id ASC
  ) cur
  LEFT JOIN dbo.users cu ON cu.id = cur.assigned_to
`;

async function listApprovals({ status, search } = {}) {
  await ensureSchema();
  const where = ["(ap.id IS NOT NULL OR a.status = 'FOR_APPROVAL')"];
  const params = [];
  const statusFilter = pick(status, APPROVAL_STATUSES);
  if (statusFilter) {
    where.push(`ISNULL(ap.status, 'PENDING') = @param${params.length}`);
    params.push(statusFilter);
  }
  const term = String(search ?? "").trim();
  if (term) {
    where.push(`(a.application_no LIKE @param${params.length} OR p.business_name LIKE @param${params.length})`);
    params.push(`%${term}%`);
  }
  const sql = `${LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY
    CASE ISNULL(ap.status, 'PENDING')
      WHEN 'PENDING' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'RETURNED' THEN 2
      WHEN 'DISAPPROVED' THEN 3 WHEN 'APPROVED' THEN 4 ELSE 5 END,
    a.id DESC`;
  return selectData(sql, params);
}

async function getSummary() {
  await ensureSchema();
  const statusRows = await selectData(`
    SELECT ISNULL(ap.status, 'PENDING') AS status, COUNT(1) AS total
    FROM dbo.applications a
    LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id
    WHERE ap.id IS NOT NULL OR a.status = 'FOR_APPROVAL'
    GROUP BY ISNULL(ap.status, 'PENDING')
  `);
  const byStatus = {};
  APPROVAL_STATUSES.forEach((s) => { byStatus[s] = 0; });
  statusRows.forEach((r) => { byStatus[String(r.status)] = Number(r.total || 0); });

  const issuedRows = await selectData(`SELECT COUNT(1) AS total FROM dbo.approval_issuances`);
  const avgRows = await selectData(`
    SELECT AVG(CAST(DATEDIFF(DAY, ap.started_at, ap.decided_at) AS FLOAT)) AS avg_days
    FROM dbo.application_approvals ap
    WHERE ap.started_at IS NOT NULL AND ap.decided_at IS NOT NULL
  `);

  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return {
    by_status: byStatus,
    total,
    in_progress: byStatus.IN_PROGRESS,
    awaiting_start: byStatus.PENDING,
    approved: byStatus.APPROVED,
    issued: Number(issuedRows?.[0]?.total || 0),
    avg_days_to_decide:
      avgRows?.[0]?.avg_days != null ? Math.round(Number(avgRows[0].avg_days) * 10) / 10 : null,
  };
}

async function listApprovers() {
  await ensureSchema();
  return selectData(`
    SELECT DISTINCT u.id, u.full_name, u.username
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id
    WHERE u.is_active = 1
      AND LOWER(LTRIM(RTRIM(r.name))) IN ('admin', 'administrator', 'officer', 'account officer', 'division chief', 'manager')
    ORDER BY u.full_name
  `);
}

async function getOrCreateApproval(applicationId, actorId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  if (!appId) return null;
  const app = await getApplicationRow(appId);
  if (!app) return null;

  await updateData(
    `IF NOT EXISTS (SELECT 1 FROM dbo.application_approvals WHERE application_id = @param0)
       INSERT INTO dbo.application_approvals (application_id, status, created_by, created_at)
       VALUES (@param0, 'PENDING', @param1, SYSUTCDATETIME());`,
    [appId, toInt(actorId)]
  );
  const rows = await selectData(
    `SELECT TOP (1) * FROM dbo.application_approvals WHERE application_id = @param0`,
    [appId]
  );
  return rows?.[0] || null;
}

async function getApprovalDetail(applicationId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  if (!appId) return null;
  const headerRows = await selectData(`${LIST_SELECT} WHERE a.id = @param0`, [appId]);
  const header = headerRows?.[0];
  if (!header) return null;

  const approvalId = toInt(header.approval_id);
  const steps = approvalId
    ? await selectData(
        `SELECT s.*, u.full_name AS assignee_name, u.username AS assignee_username,
                au.full_name AS acted_by_name, au.username AS acted_by_username
         FROM dbo.approval_steps s
         LEFT JOIN dbo.users u ON u.id = s.assigned_to
         LEFT JOIN dbo.users au ON au.id = s.acted_by
         WHERE s.approval_id = @param0
         ORDER BY s.level_no ASC, s.id ASC`,
        [approvalId]
      )
    : [];
  const issuances = approvalId
    ? await selectData(
        `SELECT i.*, d.original_file_name, d.file_name, u.full_name AS created_by_name, u.username AS created_by_username
         FROM dbo.approval_issuances i
         LEFT JOIN dbo.documents d ON d.id = i.document_id
         LEFT JOIN dbo.users u ON u.id = i.created_by
         WHERE i.approval_id = @param0
         ORDER BY i.id DESC`,
        [approvalId]
      )
    : [];
  const activity = approvalId
    ? await selectData(
        `SELECT act.*, u.full_name AS actor_name, u.username AS actor_username
         FROM dbo.approval_activity act
         LEFT JOIN dbo.users u ON u.id = act.actor_id
         WHERE act.approval_id = @param0
         ORDER BY act.id DESC`,
        [approvalId]
      )
    : [];

  const statusHistory = await Workflow.listApplicationStatusHistory(appId);
  const contract = await Contract.getByApplicationId(appId).catch(() => null);
  const documents = await Workflow.listDocumentsByApplication(appId);
  const currentStep = steps.find((s) => s.decision === "PENDING") || null;

  return { approval: header, steps, current_step: currentStep, issuances, activity, status_history: statusHistory, contract, documents };
}

/** Snapshots the active configurable levels onto the approval as a routing ladder. */
async function startApproval(applicationId, actorId) {
  const approval = await getOrCreateApproval(applicationId, actorId);
  if (!approval) return null;
  if (approval.status === "IN_PROGRESS") return getApprovalDetail(applicationId);

  const levels = await listLevels();
  if (levels.length === 0) throw new Error("No active approval levels configured. Set up the workflow first.");

  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM dbo.approval_steps WHERE approval_id = @param0`, [approval.id]);
    for (const lvl of levels) {
      await tx.query(
        `INSERT INTO dbo.approval_steps (approval_id, level_no, level_name, decision, created_at)
         VALUES (@param0, @param1, @param2, 'PENDING', SYSUTCDATETIME())`,
        [approval.id, lvl.level_no, String(lvl.name).slice(0, 150)]
      );
    }
    await tx.query(
      `UPDATE dbo.application_approvals
       SET status = 'IN_PROGRESS', current_level_no = @param1, decision = NULL, decision_summary = NULL,
           decided_by = NULL, decided_at = NULL, started_by = @param2, started_at = SYSUTCDATETIME(),
           updated_by = @param2, updated_at = SYSUTCDATETIME()
       WHERE id = @param0`,
      [approval.id, levels[0].level_no, toInt(actorId)]
    );
  });

  await logActivity(approval.id, "STARTED", `Routed through ${levels.length} level(s)`, actorId);
  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Approval started: ${app?.application_no || ""}`.trim(),
    body: `Application ${app?.application_no || ""} entered the approval workflow (${levels.length} levels).`,
  });
  return getApprovalDetail(applicationId);
}

async function assignStep(stepId, userId, actorId) {
  await ensureSchema();
  const rows = await selectData(`SELECT * FROM dbo.approval_steps WHERE id = @param0`, [toInt(stepId)]);
  const step = rows?.[0];
  if (!step) return null;
  await updateData(
    `UPDATE dbo.approval_steps SET assigned_to = @param1 WHERE id = @param0`,
    [toInt(stepId), toInt(userId)]
  );
  await logActivity(step.approval_id, "STEP_ASSIGNED", `${step.level_name} → user #${toInt(userId) ?? "—"}`, actorId);
  const appRows = await selectData(
    `SELECT application_id FROM dbo.application_approvals WHERE id = @param0`,
    [step.approval_id]
  );
  return getApprovalDetail(appRows?.[0]?.application_id);
}

async function endorseStep(stepId, { office, note, assignToUserId, actorId }) {
  await ensureSchema();
  const rows = await selectData(`SELECT * FROM dbo.approval_steps WHERE id = @param0`, [toInt(stepId)]);
  const step = rows?.[0];
  if (!step) return null;
  if (step.decision !== "PENDING") throw new Error("This level has already been decided.");
  const officeText = String(office ?? "").trim();
  if (!officeText) throw new Error("Endorsement office is required");

  await updateData(
    `UPDATE dbo.approval_steps
     SET endorsed_to_office = @param1, assigned_to = ISNULL(@param2, assigned_to),
         remarks = @param3
     WHERE id = @param0`,
    [toInt(stepId), officeText.slice(0, 150), toInt(assignToUserId), note ? String(note).slice(0, 2000) : step.remarks]
  );
  await logActivity(
    step.approval_id,
    "ENDORSED",
    `${step.level_name} endorsed to ${officeText}${note ? `: ${String(note).slice(0, 200)}` : ""}`,
    actorId
  );
  const appRows = await selectData(
    `SELECT application_id FROM dbo.application_approvals WHERE id = @param0`,
    [step.approval_id]
  );
  const applicationId = appRows?.[0]?.application_id;
  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Endorsement: ${app?.application_no || ""}`.trim(),
    body: `Application ${app?.application_no || ""} was electronically endorsed to ${officeText} at "${step.level_name}".`,
  });
  return getApprovalDetail(applicationId);
}

/** Records a decision on the level currently sitting with an approver and
 * advances (or settles) the ladder. */
async function actOnStep(stepId, { action, remarks, actorId }) {
  await ensureSchema();
  const act = pick(action, STEP_ACTIONS);
  if (!act) throw new Error("Invalid action");
  if (act === "ENDORSE") throw new Error("Use the endorse action for endorsements");

  const stepRows = await selectData(`SELECT * FROM dbo.approval_steps WHERE id = @param0`, [toInt(stepId)]);
  const step = stepRows?.[0];
  if (!step) return null;
  if (step.decision !== "PENDING") throw new Error("This level has already been decided.");

  const apRows = await selectData(`SELECT * FROM dbo.application_approvals WHERE id = @param0`, [step.approval_id]);
  const approval = apRows?.[0];
  if (!approval) return null;
  if (approval.status !== "IN_PROGRESS") throw new Error("Approval is not in progress.");

  // Enforce order: the acted step must be the earliest still-pending level.
  const pendingRows = await selectData(
    `SELECT TOP (1) id FROM dbo.approval_steps WHERE approval_id = @param0 AND decision = 'PENDING' ORDER BY level_no ASC, id ASC`,
    [step.approval_id]
  );
  if (Number(pendingRows?.[0]?.id) !== Number(step.id)) {
    throw new Error("An earlier approval level is still pending.");
  }

  const note = String(remarks ?? "").trim();
  const stepDecision = act === "APPROVE" ? "APPROVED" : act === "DISAPPROVE" ? "DISAPPROVED" : "RETURNED";

  await updateData(
    `UPDATE dbo.approval_steps
     SET decision = @param1, action = @param2, remarks = @param3, acted_by = @param4, acted_at = SYSUTCDATETIME()
     WHERE id = @param0`,
    [toInt(stepId), stepDecision, act, note || null, toInt(actorId)]
  );
  await logActivity(step.approval_id, `LEVEL_${stepDecision}`, `${step.level_name}${note ? `: ${note.slice(0, 200)}` : ""}`, actorId);

  const applicationId = approval.application_id;
  const app = await getApplicationRow(applicationId);

  if (act === "APPROVE") {
    const nextRows = await selectData(
      `SELECT TOP (1) level_no FROM dbo.approval_steps
       WHERE approval_id = @param0 AND decision = 'PENDING' ORDER BY level_no ASC, id ASC`,
      [step.approval_id]
    );
    if (nextRows?.[0]) {
      await updateData(
        `UPDATE dbo.application_approvals SET current_level_no = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME() WHERE id = @param0`,
        [step.approval_id, Number(nextRows[0].level_no), toInt(actorId)]
      );
      await notify({
        applicationId,
        actorId,
        subject: `Approval progressed: ${app?.application_no || ""}`.trim(),
        body: `Application ${app?.application_no || ""} cleared "${step.level_name}" and moved to the next approval level.`,
      });
    } else {
      await settleApproval(step.approval_id, applicationId, "APPROVED", note, actorId);
    }
  } else if (act === "DISAPPROVE") {
    await settleApproval(step.approval_id, applicationId, "DISAPPROVED", note, actorId);
  } else {
    await settleApproval(step.approval_id, applicationId, "RETURNED", note, actorId);
  }

  return getApprovalDetail(applicationId);
}

async function settleApproval(approvalId, applicationId, outcome, note, actorId) {
  const headerStatus = outcome === "APPROVED" ? "APPROVED" : outcome === "DISAPPROVED" ? "DISAPPROVED" : "RETURNED";
  await updateData(
    `UPDATE dbo.application_approvals
     SET status = @param1, decision = @param1, decision_summary = @param2, decided_by = @param3,
         decided_at = SYSUTCDATETIME(), current_level_no = NULL, updated_by = @param3, updated_at = SYSUTCDATETIME()
     WHERE id = @param0`,
    [toInt(approvalId), headerStatus, note || null, toInt(actorId)]
  );

  const targetStatus = outcome === "APPROVED" ? "APPROVED" : outcome === "DISAPPROVED" ? "DISAPPROVED" : "RETURNED";
  try {
    await Workflow.updateApplicationStatus(applicationId, {
      to_status: targetStatus,
      remarks: note || `Approval outcome: ${outcome}`,
      changed_by: toInt(actorId),
    });
  } catch (error) {
    // Surface the block (e.g. unverified mandatory requirements) but roll the
    // header back so the ladder stays actionable instead of silently stuck.
    await updateData(
      `UPDATE dbo.application_approvals
       SET status = 'IN_PROGRESS', decision = NULL, decision_summary = NULL, decided_by = NULL, decided_at = NULL,
           updated_by = @param1, updated_at = SYSUTCDATETIME()
       WHERE id = @param0`,
      [toInt(approvalId), toInt(actorId)]
    );
    await updateData(
      `UPDATE dbo.approval_steps SET decision = 'PENDING', action = NULL, acted_by = NULL, acted_at = NULL
       WHERE approval_id = @param0 AND acted_at = (SELECT MAX(acted_at) FROM dbo.approval_steps WHERE approval_id = @param0)`,
      [toInt(approvalId)]
    );
    throw error;
  }

  await logActivity(approvalId, `APPROVAL_${headerStatus}`, note ? note.slice(0, 200) : null, actorId);
  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Application ${headerStatus.toLowerCase()}: ${app?.application_no || ""}`.trim(),
    body: `Application ${app?.application_no || ""} was ${headerStatus.toLowerCase()} by the approving hierarchy${
      note ? `: ${note.slice(0, 300)}` : "."
    }`,
  });
}

async function reopenApproval(applicationId, actorId) {
  const approval = await getOrCreateApproval(applicationId, actorId);
  if (!approval) return null;
  const firstRows = await selectData(
    `SELECT TOP (1) level_no FROM dbo.approval_steps WHERE approval_id = @param0 ORDER BY level_no ASC, id ASC`,
    [approval.id]
  );
  await runInTransaction(async (tx) => {
    await tx.query(
      `UPDATE dbo.approval_steps SET decision = 'PENDING', action = NULL, remarks = NULL, acted_by = NULL, acted_at = NULL
       WHERE approval_id = @param0`,
      [approval.id]
    );
    await tx.query(
      `UPDATE dbo.application_approvals
       SET status = 'IN_PROGRESS', current_level_no = @param1, decision = NULL, decision_summary = NULL,
           decided_by = NULL, decided_at = NULL, updated_by = @param2, updated_at = SYSUTCDATETIME()
       WHERE id = @param0`,
      [approval.id, firstRows?.[0] ? Number(firstRows[0].level_no) : null, toInt(actorId)]
    );
  });
  await logActivity(approval.id, "REOPENED", `Reopened from ${approval.status}`, actorId);
  return getApprovalDetail(applicationId);
}

/* --------------------------------- Issuance -------------------------------- */

async function addIssuance(applicationId, payload, actorId) {
  const approval = await getOrCreateApproval(applicationId, actorId);
  if (!approval) return null;
  const title = String(payload?.title ?? "").trim();
  if (!title) throw new Error("title is required");

  const result = await insertData(
    `INSERT INTO dbo.approval_issuances
       (approval_id, application_id, doc_type, reference_no, title, issued_date, document_id, notes, created_by, created_at)
     OUTPUT INSERTED.id
     VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, SYSUTCDATETIME())`,
    [
      approval.id,
      toInt(applicationId),
      pick(payload?.doc_type, ISSUANCE_TYPES, "APPROVAL_ORDER"),
      payload?.reference_no ? String(payload.reference_no).slice(0, 120) : null,
      title.slice(0, 200),
      payload?.issued_date || null,
      toInt(payload?.document_id),
      payload?.notes ? String(payload.notes).slice(0, 2000) : null,
      toInt(actorId),
    ]
  );
  await logActivity(approval.id, "ISSUANCE_ADDED", title.slice(0, 200), actorId);
  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Document issued: ${app?.application_no || ""}`.trim(),
    body: `${title} was issued for application ${app?.application_no || ""}.`,
  });
  const rows = await selectData(`SELECT * FROM dbo.approval_issuances WHERE id = @param0`, [result?.recordset?.[0]?.id]);
  return rows?.[0] || null;
}

async function deleteIssuance(id, actorId) {
  await ensureSchema();
  const rows = await selectData(`SELECT * FROM dbo.approval_issuances WHERE id = @param0`, [toInt(id)]);
  const existing = rows?.[0];
  if (!existing) return false;
  await updateData(`DELETE FROM dbo.approval_issuances WHERE id = @param0`, [toInt(id)]);
  await logActivity(existing.approval_id, "ISSUANCE_DELETED", `Issuance #${id}`, actorId);
  return true;
}

async function saveContract(applicationId, payload, actorId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  if (!appId) return null;
  const contractNo = String(payload?.contract_no ?? "").trim();
  if (!contractNo) throw new Error("contract_no is required");
  if (!payload?.issue_date) throw new Error("issue_date is required");

  const approval = await getOrCreateApproval(appId, actorId);
  const existing = await Contract.getByApplicationId(appId);
  const saved = existing
    ? await Contract.updateContract(existing.id, {
        contract_no: contractNo,
        issue_date: payload.issue_date,
        effective_start: payload.effective_start ?? null,
        effective_end: payload.effective_end ?? null,
        document_id: payload.document_id ?? null,
        updated_by: toInt(actorId),
      })
    : await Contract.createContract({
        application_id: appId,
        contract_no: contractNo,
        issue_date: payload.issue_date,
        effective_start: payload.effective_start ?? null,
        effective_end: payload.effective_end ?? null,
        document_id: payload.document_id ?? null,
        created_by: toInt(actorId),
      });
  if (approval) {
    await logActivity(approval.id, existing ? "CONTRACT_UPDATED" : "CONTRACT_RECORDED", contractNo, actorId);
  }
  return saved;
}

module.exports = {
  ensureSchema,
  APPROVAL_STATUSES,
  STEP_ACTIONS,
  STEP_DECISIONS,
  ISSUANCE_TYPES,
  listLevels,
  createLevel,
  updateLevel,
  deleteLevel,
  listApprovals,
  getSummary,
  listApprovers,
  getOrCreateApproval,
  getApprovalDetail,
  startApproval,
  assignStep,
  endorseStep,
  actOnStep,
  reopenApproval,
  addIssuance,
  deleteIssuance,
  saveContract,
};
