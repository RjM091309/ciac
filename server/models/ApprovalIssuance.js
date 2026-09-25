const fs = require("fs");
const path = require("path");
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
const Proponent = require("./Proponent");
const User = require("./User");
const Role = require("./Role");
const ApplicationType = require("./ApplicationType");
const { renderContractCertificate } = require("../lib/contractCertificate");
const { STORAGE_ROOT, relativeStoragePath } = require("../lib/fileStorage");

// Tags a deliberate business-rule rejection with .status = 400 so the
// controller's fail() helper reports it as a client error instead of a 500
// — see the matching comment on fail() in c_approvals.js.
function businessError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function titleCaseRoleName(name) {
  return String(name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Renders and saves the contract's certificate PDF, then points the
 * contract row at it — same pattern as c_permits.js's permit certificate.
 * Best-effort: a failure here shouldn't fail the contract save itself. */
async function generateAndAttachContractCertificate(contract, actorId) {
  try {
    const application = await Workflow.getApplicationById(contract.application_id);
    const [proponent, applicationType, approver] = await Promise.all([
      application?.proponent_id ? Proponent.getProponentById(application.proponent_id) : Promise.resolve(null),
      application?.application_type ? ApplicationType.getByCode(application.application_type) : Promise.resolve(null),
      actorId ? User.getUserById(actorId) : Promise.resolve(null),
    ]);
    const pdfBuffer = await renderContractCertificate({
      contract,
      proponentName: proponent?.business_name || null,
      proponentAddress: proponent?.address || null,
      representativeName: proponent?.contact_name || null,
      applicationNo: application?.application_no || null,
      applicationTypeName: applicationType?.name || null,
      approvedByName: approver?.full_name || approver?.username || null,
      approvedByPosition: titleCaseRoleName(approver?.roles?.[0]?.name) || null,
    });
    const dir = path.join(STORAGE_ROOT, "contracts", String(contract.id));
    fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, "certificate.pdf");
    fs.writeFileSync(absPath, pdfBuffer);
    await Contract.setCertificatePath(contract.id, relativeStoragePath(absPath));
  } catch (error) {
    console.error("Generate contract certificate error:", error);
  }
}

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
function pick(value, allowed, fallback = null) {
  const v = String(value ?? "").trim().toUpperCase();
  return allowed.includes(v) ? v : fallback;
}

// DDL is idempotent but MSSQL still parses/compiles the whole batch each call.
// Run it once per process instead of on every model method.
let schemaReadyPromise = null;
async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaImpl().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  return schemaReadyPromise;
}

async function ensureSchemaImpl() {
  await updateSchema(`
    IF OBJECT_ID('dbo.application_approvals', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_approvals (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_application_approvals_status DEFAULT ('PENDING'),
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

    -- One decision record per application's approval (single-level: there's
    -- never more than one PENDING row per approval_id).
    IF OBJECT_ID('dbo.approval_steps', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.approval_steps (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        approval_id INT NOT NULL,
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

/* ------------------------------ Approval header ---------------------------- */

/** Which Account Officer an application's approval belongs to: the latest
 * step's assignee, else the one the Assessment Manager picked on endorsing.
 * NULL = unassigned (e.g. approvals that predate assignment), which every
 * approver can still see so nothing gets orphaned. Needs `ap` and `asm`. */
const ASSIGNEE_EXPR = `COALESCE(
    (SELECT TOP (1) s2.assigned_to FROM dbo.approval_steps s2 WHERE s2.approval_id = ap.id ORDER BY s2.id DESC),
    asm.approver_id
  )`;

const LIST_SELECT = `
  SELECT
    a.id AS application_id,
    a.application_no,
    a.application_type,
    ISNULL(at.name, a.application_type) AS application_type_name,
    a.is_renewal,
    a.status AS application_status,
    a.proponent_id,
    p.business_name AS proponent_name,
    a.submitted_at,
    ap.id AS approval_id,
    ISNULL(ap.status, 'PENDING') AS approval_status,
    ap.decision,
    ap.decision_summary,
    ap.decided_at,
    asm.id AS assessment_id,
    asm.recommendation AS assessment_recommendation,
    ISNULL(asm.charges_total, 0) AS charges_total,
    CASE WHEN ap.started_at IS NULL THEN NULL
      ELSE DATEDIFF(DAY, ap.started_at, SYSUTCDATETIME()) END AS days_in_approval,
    (SELECT COUNT(1) FROM dbo.approval_steps s WHERE s.approval_id = ap.id) AS total_steps,
    (SELECT COUNT(1) FROM dbo.approval_steps s WHERE s.approval_id = ap.id AND s.decision = 'APPROVED') AS approved_steps,
    (SELECT COUNT(1) FROM dbo.contracts c WHERE c.application_id = a.id) AS issued_count,
    cur.assigned_to AS current_assigned_to,
    cu.full_name AS current_assignee_name,
    cu.username AS current_assignee_username,
    ${ASSIGNEE_EXPR} AS approval_assignee_id
  FROM dbo.applications a
  LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
  LEFT JOIN dbo.application_types at ON at.code = a.application_type
  LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id
  LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
  OUTER APPLY (
    SELECT TOP (1) s.assigned_to
    FROM dbo.approval_steps s
    WHERE s.approval_id = ap.id AND s.decision = 'PENDING'
    ORDER BY s.id ASC
  ) cur
  LEFT JOIN dbo.users cu ON cu.id = cur.assigned_to
`;

/** `assigneeId` limits the queue to one Account Officer's approvals (plus
 * any still unassigned) — every non-admin approver is scoped this way. */
async function listApprovals({ status, search, assigneeId } = {}) {
  await ensureSchema();
  const where = ["(ap.id IS NOT NULL OR a.status = 'FOR_APPROVAL')"];
  const params = [];
  const asgId = toInt(assigneeId);
  if (asgId) {
    where.push(`(${ASSIGNEE_EXPR} = @param${params.length} OR ${ASSIGNEE_EXPR} IS NULL)`);
    params.push(asgId);
  }
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

async function getSummary({ assigneeId } = {}) {
  await ensureSchema();
  const asgId = toInt(assigneeId);
  const asgFilter = asgId ? `AND (${ASSIGNEE_EXPR} = @param0 OR ${ASSIGNEE_EXPR} IS NULL)` : "";
  const asgParams = asgId ? [asgId] : [];
  const statusRows = await selectData(
    `
    SELECT ISNULL(ap.status, 'PENDING') AS status, COUNT(1) AS total
    FROM dbo.applications a
    LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
    WHERE (ap.id IS NOT NULL OR a.status = 'FOR_APPROVAL') ${asgFilter}
    GROUP BY ISNULL(ap.status, 'PENDING')
    `,
    asgParams
  );
  const byStatus = {};
  APPROVAL_STATUSES.forEach((s) => { byStatus[s] = 0; });
  statusRows.forEach((r) => { byStatus[String(r.status)] = Number(r.total || 0); });

  const issuedRows = await selectData(
    `
    SELECT COUNT(1) AS total
    FROM dbo.contracts c
    INNER JOIN dbo.application_approvals ap ON ap.application_id = c.application_id
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = ap.application_id
    WHERE 1 = 1 ${asgFilter}
    `,
    asgParams
  );
  const avgRows = await selectData(
    `
    SELECT AVG(CAST(DATEDIFF(DAY, ap.started_at, ap.decided_at) AS FLOAT)) AS avg_days
    FROM dbo.application_approvals ap
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = ap.application_id
    WHERE ap.started_at IS NOT NULL AND ap.decided_at IS NOT NULL ${asgFilter}
    `,
    asgParams
  );

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

/** The Account Officer an application's approval belongs to (see
 * ASSIGNEE_EXPR); null when unassigned. */
async function getApprovalAssigneeId(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1) ${ASSIGNEE_EXPR} AS assignee_id
    FROM dbo.applications a
    LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
    WHERE a.id = @param0
    `,
    [toInt(applicationId)]
  );
  return toInt(rows?.[0]?.assignee_id);
}

async function getApplicationIdForStep(stepId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1) ap.application_id
    FROM dbo.approval_steps s
    INNER JOIN dbo.application_approvals ap ON ap.id = s.approval_id
    WHERE s.id = @param0
    `,
    [toInt(stepId)]
  );
  return toInt(rows?.[0]?.application_id);
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
         ORDER BY s.id ASC`,
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

  // Charges are assessed during Assessment Evaluation, against the same
  // assessment_charges table it uses — reuse its rows rather than
  // duplicating a second charges table.
  const assessmentId = toInt(header.assessment_id);
  const charges = assessmentId
    ? await selectData(
        `SELECT * FROM dbo.assessment_charges WHERE assessment_id = @param0 ORDER BY id ASC`,
        [assessmentId]
      )
    : [];

  return {
    approval: header,
    steps,
    current_step: currentStep,
    activity,
    status_history: statusHistory,
    contract,
    documents,
    charges,
  };
}

/* ---------------------------------- Charges -------------------------------- */
// The Account Officer assesses charges after re-verifying documents (Level 1
// of the routing ladder) — delegate to Assessment's charge storage/recompute
// logic rather than duplicating it, and log the action on this module's own
// activity feed too so it shows up in the approval History tab.

async function addCharge(applicationId, payload, actorId) {
  const row = await Assessment.addCharge(applicationId, payload, actorId);
  const approval = await getOrCreateApproval(applicationId, actorId);
  if (approval) {
    await logActivity(approval.id, "CHARGE_ADDED", `${payload?.description || ""}`.slice(0, 200), actorId);
  }
  return row;
}

async function updateCharge(id, payload, actorId) {
  return Assessment.updateCharge(id, payload, actorId);
}

async function deleteCharge(id, actorId) {
  return Assessment.deleteCharge(id, actorId);
}

/** Opens the single pending approval step. `assignTo` is the Account Officer
 * the Assessment Manager picked; when omitted (e.g. a manual restart from
 * the Approval screen) it falls back to the one recorded on the assessment.
 * The step's assigned_to limits who may act on it — see actOnStep. */
async function startApproval(applicationId, actorId, { assignTo } = {}) {
  const approval = await getOrCreateApproval(applicationId, actorId);
  if (!approval) return null;
  let assigneeId = toInt(assignTo);
  if (!assigneeId) {
    const asmRows = await selectData(
      `SELECT TOP (1) approver_id FROM dbo.application_assessments WHERE application_id = @param0`,
      [toInt(applicationId)]
    );
    assigneeId = toInt(asmRows?.[0]?.approver_id);
  }
  if (approval.status === "IN_PROGRESS") return getApprovalDetail(applicationId);
  // A settled approval with an actual decision on record (a contract may
  // already be issued off of an APPROVED one) must never be silently wiped
  // and restarted — only IN_PROGRESS short-circuits above. RETURNED is
  // deliberately NOT in this list: it's the routine "kicked back, redo the
  // recommendation" outcome with no decision/contract to protect, and the
  // ENDORSE -> FOR_APPROVAL -> here path needs to be able to restart it.
  if (["APPROVED", "DISAPPROVED"].includes(approval.status)) {
    throw businessError("This application's approval has already been decided — its routing history can't be restarted automatically.");
  }

  await runInTransaction(async (tx) => {
    // The status checks above read a stale snapshot — this UPDATE re-checks
    // the same condition atomically (excluding IN_PROGRESS/APPROVED/
    // DISAPPROVED) before anything destructive runs, so a concurrent
    // start/settle can't race past the checks and still wipe the step.
    const guard = await tx.query(
      `UPDATE dbo.application_approvals
       SET status = 'IN_PROGRESS', decision = NULL, decision_summary = NULL,
           decided_by = NULL, decided_at = NULL, started_by = @param1, started_at = SYSUTCDATETIME(),
           updated_by = @param1, updated_at = SYSUTCDATETIME()
       WHERE id = @param0 AND status NOT IN ('IN_PROGRESS', 'APPROVED', 'DISAPPROVED')`,
      [approval.id, toInt(actorId)]
    );
    if (!guard?.rowsAffected?.[0]) {
      throw businessError("This application's approval can't be restarted right now — it may have just been acted on elsewhere.");
    }

    await tx.query(`DELETE FROM dbo.approval_steps WHERE approval_id = @param0`, [approval.id]);
    // DBs not yet migrated to the single-level schema still have NOT NULL
    // level_no/level_name columns — fill them with the old level-1 values.
    const legacyCols = await tx.query(`SELECT COL_LENGTH('dbo.approval_steps', 'level_no') AS level_no`);
    const hasLegacyLevel = legacyCols?.recordset?.[0]?.level_no != null;
    await tx.query(
      hasLegacyLevel
        ? `INSERT INTO dbo.approval_steps (approval_id, level_no, level_name, assigned_to, decision, created_at) VALUES (@param0, 1, N'Account Officer Review', @param1, 'PENDING', SYSUTCDATETIME())`
        : `INSERT INTO dbo.approval_steps (approval_id, assigned_to, decision, created_at) VALUES (@param0, @param1, 'PENDING', SYSUTCDATETIME())`,
      [approval.id, assigneeId]
    );
  });

  let assigneeName = null;
  if (assigneeId) {
    const u = await selectData(`SELECT TOP (1) full_name, username FROM dbo.users WHERE id = @param0`, [assigneeId]);
    assigneeName = u?.[0]?.full_name || u?.[0]?.username || null;
  }
  await logActivity(approval.id, "STARTED", assigneeName ? `Approval started — assigned to ${assigneeName}` : "Approval started", actorId);
  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Approval started: ${app?.application_no || ""}`.trim(),
    body: `Application ${app?.application_no || ""} entered the approval workflow${assigneeName ? `, assigned to ${assigneeName}` : ""}.`,
  });
  return getApprovalDetail(applicationId);
}

async function endorseStep(stepId, { office, note, assignToUserId, actorId }) {
  await ensureSchema();
  const rows = await selectData(`SELECT * FROM dbo.approval_steps WHERE id = @param0`, [toInt(stepId)]);
  const step = rows?.[0];
  if (!step) return null;
  if (step.decision !== "PENDING") throw businessError("This approval has already been decided.");
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
    `Endorsed to ${officeText}${note ? `: ${String(note).slice(0, 200)}` : ""}`,
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
    body: `Application ${app?.application_no || ""} was electronically endorsed to ${officeText}.`,
  });
  return getApprovalDetail(applicationId);
}

/** Records a decision on the one pending approval step and settles the
 * approval immediately (APPROVE/DISAPPROVE/RETURN are all final now — there's
 * no next level to advance to). */
async function actOnStep(stepId, { action, remarks, actorId, override_unverified }) {
  await ensureSchema();
  const act = pick(action, STEP_ACTIONS);
  if (!act) throw new Error("Invalid action");
  if (act === "ENDORSE") throw new Error("Use the endorse action for endorsements");

  const stepRows = await selectData(`SELECT * FROM dbo.approval_steps WHERE id = @param0`, [toInt(stepId)]);
  const step = stepRows?.[0];
  if (!step) return null;
  if (step.decision !== "PENDING") throw businessError("This approval has already been decided.");

  const apRows = await selectData(`SELECT * FROM dbo.application_approvals WHERE id = @param0`, [step.approval_id]);
  const approval = apRows?.[0];
  if (!approval) return null;
  if (approval.status !== "IN_PROGRESS") throw businessError("Approval is not in progress.");

  // assigned_to restricts who may act to that one person (or admin); with no
  // assignee, anyone with approval:queue edit access (enforced by the route's
  // requireMenuAccess middleware) or admin may act.
  const isAdmin = await Role.userHasRoleName(actorId, "admin");
  if (!isAdmin && step.assigned_to && Number(step.assigned_to) !== Number(actorId)) {
    throw businessError("This approval is assigned to someone else.");
  }

  // Approving settles the whole application to APPROVED, so mandatory
  // requirements must be verified BEFORE writing the step's decision below —
  // checking only inside settleApproval (after the step is already committed
  // as APPROVED) would leave it stuck "decided" with no way back to PENDING
  // if the check then rejects it.
  if (act === "APPROVE") {
    await assertMandatoryRequirementsVerified(approval.application_id, { override: override_unverified });
  }

  const note = String(remarks ?? "").trim();
  const stepDecision = act === "APPROVE" ? "APPROVED" : act === "DISAPPROVE" ? "DISAPPROVED" : "RETURNED";

  // The PENDING check above is a separate read, so two concurrent requests
  // for the same step could both pass it before either writes — this WHERE
  // clause makes the actual write the atomic compare-and-swap: only the
  // first one to reach the DB actually flips the row, and whoever loses the
  // race gets rowsAffected=0 here instead of silently double-deciding it.
  const result = await updateData(
    `UPDATE dbo.approval_steps
     SET decision = @param1, action = @param2, remarks = @param3, acted_by = @param4, acted_at = SYSUTCDATETIME()
     WHERE id = @param0 AND decision = 'PENDING'`,
    [toInt(stepId), stepDecision, act, note || null, toInt(actorId)]
  );
  if (!result?.rowsAffected?.[0]) {
    throw businessError("This approval has already been decided.");
  }
  await logActivity(
    step.approval_id,
    `LEVEL_${stepDecision}`,
    `${override_unverified ? "Approved despite unverified mandatory requirements" : stepDecision}${note ? `: ${note.slice(0, 200)}` : ""}`,
    actorId
  );

  const applicationId = approval.application_id;
  await settleApproval(step.approval_id, applicationId, stepDecision, note, actorId, { override_unverified });

  return getApprovalDetail(applicationId);
}

// The one meaningful business-rule gate on reaching APPROVED: every
// mandatory requirement must be verified first. Called from actOnStep
// BEFORE it writes a final-level APPROVE decision (so a rejection never
// leaves a step stuck "decided" with nothing to roll back to), and again
// from settleApproval as a defensive second check for any other caller.
// `r.is_active = 1` matters: a mandatory requirement that was later
// deactivated (directly, or via an ApplicationType/RequirementCategory
// cascade) must not permanently block approval — there's no longer any way
// to verify something that's been hidden from the catalog.
/** `override` lets a final-level approver explicitly push an APPROVE through
 * despite unverified mandatory requirements, after confirming the frontend's
 * "N requirements aren't verified — approve anyway?" prompt — the officer's
 * deliberate override, not a silent bypass, and it's noted on the level's
 * activity log entry (see actOnStep) for the audit trail. */
async function assertMandatoryRequirementsVerified(applicationId, { override = false } = {}) {
  if (override) return;
  const unverifiedRows = await selectData(
    `
    SELECT COUNT(1) AS n
    FROM dbo.application_requirements ar
    INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
    WHERE ar.application_id = @param0
      AND r.is_mandatory = 1
      AND r.is_active = 1
      AND ar.status <> 'VERIFIED'
    `,
    [toInt(applicationId)]
  );
  const unverified = Number(unverifiedRows?.[0]?.n || 0);
  if (unverified > 0) {
    throw businessError(
      `Cannot approve — ${unverified} mandatory requirement${unverified === 1 ? "" : "s"} ${unverified === 1 ? "is" : "are"} not yet verified.`
    );
  }
}

async function settleApproval(approvalId, applicationId, outcome, note, actorId, { override_unverified } = {}) {
  if (outcome === "APPROVED") {
    await assertMandatoryRequirementsVerified(applicationId, { override: override_unverified });
  }

  const headerStatus = outcome === "APPROVED" ? "APPROVED" : outcome === "DISAPPROVED" ? "DISAPPROVED" : "RETURNED";
  await updateData(
    `UPDATE dbo.application_approvals
     SET status = @param1, decision = @param1, decision_summary = @param2, decided_by = @param3,
         decided_at = SYSUTCDATETIME(), updated_by = @param3, updated_at = SYSUTCDATETIME()
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

  // RETURNED is the routine "an approver kicked it back" outcome, not a
  // real decision — the Assessment Officer redoing their recommendation is
  // the normal way to handle it (see reopen()'s own comment on this), so
  // auto-reopen the assessment here instead of leaving it stuck COMPLETED
  // with no way out short of an admin-only manual reopen. Best-effort: a
  // failure here shouldn't fail the RETURNED settlement itself.
  if (headerStatus === "RETURNED") {
    try {
      await Assessment.reopen(applicationId, actorId);
    } catch (error) {
      console.error("Auto-reopen assessment on RETURNED error:", error);
    }
  }

  const app = await getApplicationRow(applicationId);
  // APPROVED has a real next step (recording the contract on the Contract
  // tab) that nothing else prompts anyone to do — the settlement itself
  // never touches dbo.contracts/permits, so without this the only trace is
  // a passive status change nobody's specifically told to act on.
  const nextStepNote =
    headerStatus === "APPROVED" ? " Record the contract on the Contract tab to complete this application's file." : "";
  await notify({
    applicationId,
    actorId,
    subject: `Application ${headerStatus.toLowerCase()}: ${app?.application_no || ""}`.trim(),
    body: `Application ${app?.application_no || ""} was ${headerStatus.toLowerCase()}${
      note ? `: ${note.slice(0, 300)}` : "."
    }${nextStepNote}`,
  });
}

async function reopenApproval(applicationId, actorId) {
  const approval = await getOrCreateApproval(applicationId, actorId);
  if (!approval) return null;
  await runInTransaction(async (tx) => {
    await tx.query(
      `UPDATE dbo.approval_steps SET decision = 'PENDING', action = NULL, remarks = NULL, acted_by = NULL, acted_at = NULL
       WHERE approval_id = @param0`,
      [approval.id]
    );
    await tx.query(
      `UPDATE dbo.application_approvals
       SET status = 'IN_PROGRESS', decision = NULL, decision_summary = NULL,
           decided_by = NULL, decided_at = NULL, updated_by = @param1, updated_at = SYSUTCDATETIME()
       WHERE id = @param0`,
      [approval.id, toInt(actorId)]
    );
  });
  await logActivity(approval.id, "REOPENED", `Reopened from ${approval.status}`, actorId);
  return getApprovalDetail(applicationId);
}

async function previewContractNo(applicationId) {
  const app = await getApplicationRow(applicationId);
  if (!app) return null;
  return Contract.previewContractNo(app.application_type);
}

async function saveContract(applicationId, payload, actorId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  if (!appId) return null;

  const approval = await getOrCreateApproval(appId, actorId);
  const existing = await Contract.getByApplicationId(appId);
  // contract_no and issue_date are server-generated / audit-trail only —
  // never accepted from the client, and never touched once a contract
  // exists. Only effective dates and the executed file stay editable.
  const saved = existing
    ? await Contract.updateContract(existing.id, {
        effective_start: payload.effective_start ?? null,
        effective_end: payload.effective_end ?? null,
        document_id: payload.document_id ?? existing.document_id ?? null,
        updated_by: toInt(actorId),
      })
    : await Contract.createContract({
        application_id: appId,
        application_type: (await getApplicationRow(appId))?.application_type,
        effective_start: payload.effective_start ?? null,
        effective_end: payload.effective_end ?? null,
        document_id: payload.document_id ?? null,
        created_by: toInt(actorId),
      });
  if (approval) {
    await logActivity(approval.id, existing ? "CONTRACT_UPDATED" : "CONTRACT_RECORDED", saved?.contract_no, actorId);
  }
  if (saved) {
    // Regenerated on every save so the certificate always reflects the
    // latest contract details (dates, contract no. may have just changed).
    await generateAndAttachContractCertificate(saved, actorId);
    return Contract.getById(saved.id);
  }
  return saved;
}

module.exports = {
  ensureSchema,
  APPROVAL_STATUSES,
  STEP_ACTIONS,
  STEP_DECISIONS,
  listApprovals,
  getSummary,
  getApprovalAssigneeId,
  getApplicationIdForStep,
  getOrCreateApproval,
  getApprovalDetail,
  startApproval,
  endorseStep,
  actOnStep,
  reopenApproval,
  saveContract,
  previewContractNo,
  CHARGE_TYPES: Assessment.CHARGE_TYPES,
  addCharge,
  updateCharge,
  deleteCharge,
};
