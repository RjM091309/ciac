const {
  selectData,
  insertData,
  updateData,
  updateSchema,
  runInTransaction,
} = require("../config/database");
const Notification = require("./Notification");
const Workflow = require("./ApplicationWorkflow");
const ControlPanelPermission = require("./ControlPanelPermission");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Tags a deliberate business-rule rejection with .status = 400 so the
// controller's fail() helper reports it as a client error instead of a 500
// — see the matching comment on fail() in c_assessments.js.
function businessError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function toDecimal(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const STAGES = [
  "UNASSIGNED",
  "ASSIGNED",
  "IN_REVIEW",
  "FOR_RECOMMENDATION",
  "COMPLETED",
  "RETURNED",
];

const CHARGE_TYPES = ["RENTAL", "PROCESSING_FEE", "TAX", "PENALTY", "OTHER"];
const RECOMMENDATIONS = ["ENDORSE", "DISAPPROVE"];

/** Days after assignment before an in-progress assessment counts as overdue. */
const OVERDUE_DAYS = 5;

function pick(value, allowed, fallback = null) {
  const v = String(value ?? "").trim().toUpperCase();
  return allowed.includes(v) ? v : fallback;
}

// Schema DDL is idempotent but not free to parse/compile on MSSQL. Run it once
// per process instead of on every model call (each page load hit this 3+ times).
let schemaReadyPromise = null;
async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaImpl().catch((err) => {
      schemaReadyPromise = null; // let the next call retry if the DDL failed
      throw err;
    });
  }
  return schemaReadyPromise;
}

async function ensureSchemaImpl() {
  await updateSchema(`
    IF OBJECT_ID('dbo.application_assessments', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_assessments (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        assigned_evaluator_id INT NULL,
        assigned_by INT NULL,
        assigned_at DATETIME2(3) NULL,
        stage NVARCHAR(30) NOT NULL CONSTRAINT DF_application_assessments_stage DEFAULT ('UNASSIGNED'),
        recommendation NVARCHAR(20) NULL,
        recommendation_summary NVARCHAR(2000) NULL,
        recommended_by INT NULL,
        recommended_at DATETIME2(3) NULL,
        charges_total DECIMAL(18,2) NOT NULL CONSTRAINT DF_application_assessments_charges_total DEFAULT (0),
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_application_assessments_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE UNIQUE INDEX UX_application_assessments_application_id ON dbo.application_assessments(application_id);
      CREATE INDEX IX_application_assessments_stage ON dbo.application_assessments(stage);
      CREATE INDEX IX_application_assessments_evaluator ON dbo.application_assessments(assigned_evaluator_id);
    END;

    IF OBJECT_ID('dbo.assessment_charges', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.assessment_charges (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        assessment_id INT NOT NULL,
        charge_type NVARCHAR(20) NOT NULL CONSTRAINT DF_assessment_charges_type DEFAULT ('OTHER'),
        description NVARCHAR(500) NOT NULL,
        rate_basis NVARCHAR(100) NULL,
        quantity DECIMAL(18,4) NULL,
        unit_rate DECIMAL(18,4) NULL,
        amount DECIMAL(18,2) NOT NULL CONSTRAINT DF_assessment_charges_amount DEFAULT (0),
        remarks NVARCHAR(500) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_assessment_charges_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_assessment_charges_assessment_id ON dbo.assessment_charges(assessment_id);
    END;

    IF OBJECT_ID('dbo.assessment_activity', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.assessment_activity (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        assessment_id INT NOT NULL,
        action NVARCHAR(40) NOT NULL,
        detail NVARCHAR(1000) NULL,
        actor_id INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_assessment_activity_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_assessment_activity_assessment_id ON dbo.assessment_activity(assessment_id);
    END;
  `);
}

async function logActivity(assessmentId, action, detail, actorId) {
  try {
    await insertData(
      `
      INSERT INTO dbo.assessment_activity (assessment_id, action, detail, actor_id, created_at)
      VALUES (@param0, @param1, @param2, @param3, SYSUTCDATETIME())
      `,
      [toInt(assessmentId), String(action).slice(0, 40), detail ? String(detail).slice(0, 1000) : null, toInt(actorId)]
    );
  } catch (error) {
    console.error("Log assessment activity error:", error);
  }
}

/** Entry point for activity that originates outside this module (e.g. a
 * requirement verify/reject, which lives in ApplicationWorkflow.js) — same
 * assessment_activity feed, just resolved by applicationId instead of an
 * already-known assessmentId. Lazily creates the assessment row if this is
 * somehow the first assessment-related action for the application, same as
 * every other write path here. */
async function logRequirementActivity(applicationId, { action, detail, actorId }) {
  try {
    const asm = await getOrCreateAssessment(applicationId, actorId);
    if (!asm) return;
    await logActivity(asm.id, action, detail, actorId);
  } catch (error) {
    console.error("Log requirement activity error:", error);
  }
}

async function notify({ applicationId, actorId, subject, body }) {
  try {
    await Notification.createApplicationScopedNotifications({
      applicationId,
      actorId,
      eventType: "assessment",
      subject,
      body,
    });
  } catch (error) {
    console.error("Assessment notification error:", error);
  }
}

async function getApplicationRow(applicationId) {
  const rows = await selectData(
    `
    SELECT TOP (1) a.id, a.application_no, a.application_type, a.is_renewal, a.status, a.proponent_id
    FROM dbo.applications a
    WHERE a.id = @param0
    `,
    [toInt(applicationId)]
  );
  return rows?.[0] || null;
}

/** Upsert + return the assessment header row for an application. */
async function getOrCreateAssessment(applicationId, actorId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  if (!appId) return null;

  const app = await getApplicationRow(appId);
  if (!app) return null;

  await updateData(
    `
    IF NOT EXISTS (SELECT 1 FROM dbo.application_assessments WHERE application_id = @param0)
      INSERT INTO dbo.application_assessments (application_id, stage, created_by, created_at)
      VALUES (@param0, 'UNASSIGNED', @param1, SYSUTCDATETIME());
    `,
    [appId, toInt(actorId)]
  );

  const rows = await selectData(
    `SELECT TOP (1) * FROM dbo.application_assessments WHERE application_id = @param0`,
    [appId]
  );
  return rows?.[0] || null;
}

async function recomputeChargesTotal(assessmentId, actorId, tx) {
  const run = tx
    ? (q, p) => tx.query(q, p)
    : (q, p) => updateData(q, p);
  await run(
    `
    UPDATE dbo.application_assessments
    SET charges_total = ISNULL((
      SELECT SUM(amount) FROM dbo.assessment_charges WHERE assessment_id = @param0
    ), 0),
    updated_by = @param1,
    updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [toInt(assessmentId), toInt(actorId)]
  );
}

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
    a.created_at AS application_created_at,
    asm.id AS assessment_id,
    ISNULL(asm.stage, 'UNASSIGNED') AS stage,
    asm.assigned_evaluator_id,
    ev.full_name AS evaluator_name,
    ev.username AS evaluator_username,
    asm.assigned_at,
    asm.recommendation,
    asm.recommended_at,
    ISNULL(asm.charges_total, 0) AS charges_total,
    -- Freezes at recommended_at once a recommendation is submitted (COMPLETED
    -- or RETURNED both set it) so a finished assessment stops looking like
    -- it's still aging every day it sits in the list after that.
    CASE WHEN asm.assigned_at IS NULL THEN NULL
      ELSE DATEDIFF(DAY, asm.assigned_at, ISNULL(asm.recommended_at, SYSUTCDATETIME())) END AS days_in_assessment,
    (SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id) AS requirements_total,
    (SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id AND ar.status = 'VERIFIED') AS requirements_verified,
    -- Per-document breakdown for the list's "X/Y verified" tooltip — small
    -- enough per application (a handful of requirements) to inline here
    -- rather than a separate round trip per row on hover.
    (
      SELECT r.name AS name, ar.status AS status
      FROM dbo.application_requirements ar
      LEFT JOIN dbo.requirements r ON r.id = ar.requirement_id
      WHERE ar.application_id = a.id
      ORDER BY r.name
      FOR JSON PATH
    ) AS requirements_breakdown
  FROM dbo.applications a
  LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
  LEFT JOIN dbo.application_types at ON at.code = a.application_type
  LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
  LEFT JOIN dbo.users ev ON ev.id = asm.assigned_evaluator_id
`;

async function listAssessments({ stage, evaluatorId, search } = {}) {
  await ensureSchema();
  const where = [
    // A DRAFT application was never submitted and shouldn't be reviewable
    // yet; REJECTED is the pre-assessment screening decision (New
    // Applications), an application rejected there never enters this queue.
    // The LEFT JOIN's ISNULL(...'UNASSIGNED') default was showing both as
    // phantom "unassigned" rows even though no real assessment row exists —
    // asm.id IS NOT NULL still surfaces a genuine (historical) assessment
    // record for either status, so nothing real gets hidden.
    "(a.status NOT IN ('DRAFT', 'REJECTED') OR asm.id IS NOT NULL)",
  ];
  const params = [];
  const stageFilter = pick(stage, STAGES);
  if (stageFilter) {
    where.push(`ISNULL(asm.stage, 'UNASSIGNED') = @param${params.length}`);
    params.push(stageFilter);
  }
  const evId = toInt(evaluatorId);
  if (evId) {
    where.push(`asm.assigned_evaluator_id = @param${params.length}`);
    params.push(evId);
  }
  const term = String(search ?? "").trim();
  if (term) {
    where.push(
      `(a.application_no LIKE @param${params.length} OR p.business_name LIKE @param${params.length})`
    );
    params.push(`%${term}%`);
  }
  const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY
    CASE ISNULL(asm.stage, 'UNASSIGNED')
      WHEN 'UNASSIGNED' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'IN_REVIEW' THEN 2
      WHEN 'FOR_RECOMMENDATION' THEN 3 WHEN 'RETURNED' THEN 4 WHEN 'COMPLETED' THEN 5 ELSE 6 END,
    a.id DESC`;
  const rows = await selectData(sql, params);
  return rows.map((r) => ({
    ...r,
    requirements_breakdown: r.requirements_breakdown ? JSON.parse(r.requirements_breakdown) : [],
  }));
}

async function getSummary() {
  await ensureSchema();
  const stageRows = await selectData(`
    SELECT ISNULL(asm.stage, 'UNASSIGNED') AS stage, COUNT(1) AS total
    FROM dbo.applications a
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
    WHERE (a.status NOT IN ('DRAFT', 'REJECTED') OR asm.id IS NOT NULL)
    GROUP BY ISNULL(asm.stage, 'UNASSIGNED')
  `);
  const byStage = {};
  STAGES.forEach((s) => { byStage[s] = 0; });
  stageRows.forEach((r) => { byStage[String(r.stage)] = Number(r.total || 0); });

  const overdueRows = await selectData(
    `
    SELECT COUNT(1) AS total
    FROM dbo.application_assessments asm
    WHERE asm.stage IN ('ASSIGNED', 'IN_REVIEW', 'FOR_RECOMMENDATION')
      AND asm.assigned_at IS NOT NULL
      AND DATEDIFF(DAY, asm.assigned_at, SYSUTCDATETIME()) > @param0
    `,
    [OVERDUE_DAYS]
  );

  const avgRows = await selectData(`
    SELECT AVG(CAST(DATEDIFF(DAY, asm.assigned_at, asm.recommended_at) AS FLOAT)) AS avg_days
    FROM dbo.application_assessments asm
    WHERE asm.recommended_at IS NOT NULL AND asm.assigned_at IS NOT NULL
  `);

  const total = Object.values(byStage).reduce((sum, n) => sum + n, 0);
  return {
    by_stage: byStage,
    total,
    active: byStage.ASSIGNED + byStage.IN_REVIEW + byStage.FOR_RECOMMENDATION,
    overdue: Number(overdueRows?.[0]?.total || 0),
    avg_days_to_complete: avgRows?.[0]?.avg_days != null ? Math.round(Number(avgRows[0].avg_days) * 10) / 10 : null,
  };
}

/** Who can be assigned to do an assessment — any role with Control Panel
 * sidebar access to assessment:queue (conventionally "Assessment Officer"),
 * plus admin. Driven by permission rather than a hardcoded role name so it
 * survives a rename and extends to any future custom role automatically,
 * same reasoning as hasStaffApplicationAccess/getApprovalQueueStaffEmails
 * elsewhere in this app. */
async function listAssignableEvaluators() {
  await ensureSchema();
  await ControlPanelPermission.ensureSchema();
  return selectData(`
    SELECT DISTINCT u.id, u.full_name, u.username
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id
    LEFT JOIN dbo.role_sidebar_menu_permissions p
      ON p.role_id = r.id AND p.menu_key = 'assessment:queue' AND p.is_enabled = 1
    WHERE u.is_active = 1
      AND (LOWER(LTRIM(RTRIM(r.name))) = 'admin' OR p.role_id IS NOT NULL)
    ORDER BY u.full_name
  `);
}

async function getAssessmentDetail(applicationId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  if (!appId) return null;
  const headerRows = await selectData(`${LIST_SELECT} WHERE a.id = @param0`, [appId]);
  const header = headerRows?.[0];
  if (!header) return null;

  const assessmentId = toInt(header.assessment_id);
  const charges = assessmentId
    ? await selectData(
        `SELECT * FROM dbo.assessment_charges WHERE assessment_id = @param0 ORDER BY id ASC`,
        [assessmentId]
      )
    : [];
  const activity = assessmentId
    ? await selectData(
        `
        SELECT act.*, u.full_name AS actor_name, u.username AS actor_username
        FROM dbo.assessment_activity act
        LEFT JOIN dbo.users u ON u.id = act.actor_id
        WHERE act.assessment_id = @param0
        ORDER BY act.id DESC
        `,
        [assessmentId]
      )
    : [];

  const requirements = await Workflow.listApplicationRequirements(appId);
  const documents = await Workflow.listDocumentsByApplication(appId);

  return { assessment: header, charges, activity, requirements, documents };
}

async function assignEvaluator(applicationId, { evaluatorId, actorId }) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  const evId = toInt(evaluatorId);
  if (!evId) throw new Error("evaluatorId is required");

  const nextStage = ["UNASSIGNED", "ASSIGNED"].includes(asm.stage) ? "ASSIGNED" : asm.stage;
  await updateData(
    `
    UPDATE dbo.application_assessments
    SET assigned_evaluator_id = @param1, assigned_by = @param2, assigned_at = SYSUTCDATETIME(),
        stage = @param3, updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [asm.id, evId, toInt(actorId), nextStage]
  );

  const evRows = await selectData(`SELECT TOP (1) full_name, username FROM dbo.users WHERE id = @param0`, [evId]);
  const evName = evRows?.[0]?.full_name || evRows?.[0]?.username || `User #${evId}`;
  await logActivity(asm.id, "ASSIGNED", `Assigned to ${evName}`, actorId);

  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Assessment assigned: ${app?.application_no || ""}`.trim(),
    body: `Application ${app?.application_no || ""} was assigned to ${evName} for assessment.`,
  });

  return getAssessmentDetail(applicationId);
}

async function setStage(applicationId, { stage, actorId }) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  const next = pick(stage, STAGES);
  if (!next) throw new Error("Invalid stage");
  // A closed assessment (COMPLETED/RETURNED) only leaves that state through
  // the admin-gated reopen() — which also clears the stale recommendation.
  // Without this, any evaluator with ordinary edit rights could move it
  // straight back to e.g. IN_REVIEW via this endpoint, leaving
  // recommendation set (Submit stays disabled) with no Reopen button left
  // to show (it only renders for COMPLETED/RETURNED) — a stuck dead end.
  if (asm.stage === "COMPLETED" || asm.stage === "RETURNED") {
    throw businessError("This assessment is closed — use Reopen (admin) to move it out of a closed stage.");
  }
  // The check above reads a stale snapshot — closing this with the same
  // compare-and-swap technique as actOnStep's decision write, so a
  // concurrent request can't sneak a stage change through between the read
  // and this write.
  const result = await updateData(
    `
    UPDATE dbo.application_assessments
    SET stage = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHERE id = @param0 AND stage NOT IN ('COMPLETED', 'RETURNED')
    `,
    [asm.id, next, toInt(actorId)]
  );
  if (!result?.rowsAffected?.[0]) {
    throw businessError("This assessment is closed — use Reopen (admin) to move it out of a closed stage.");
  }
  await logActivity(asm.id, "STAGE_CHANGED", `${asm.stage} → ${next}`, actorId);
  return getAssessmentDetail(applicationId);
}

async function reopen(applicationId, actorId) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  // If Approval already reached a real decision (APPROVED/DISAPPROVED — a
  // contract may already be issued off of it), reopening the assessment is a
  // dead end anyway: resubmitting a fresh recommendation would try to
  // restart that already-decided approval, which startApproval() now
  // refuses to do. Surface the conflict here instead of leaving the officer
  // stuck one step later. RETURNED is deliberately excluded — it's the
  // routine "approver kicked it back" outcome with no decision to protect,
  // and reopening the assessment to redo the recommendation is exactly the
  // normal way to handle it.
  {
    // Lazy require — ApprovalIssuance.js requires this module too (see the
    // matching comment in submitRecommendation).
    const ApprovalIssuance = require("./ApprovalIssuance");
    const detail = await ApprovalIssuance.getApprovalDetail(applicationId);
    const approvalStatus = detail?.approval?.approval_status;
    if (["APPROVED", "DISAPPROVED"].includes(approvalStatus)) {
      throw businessError(
        "This application's approval has already been decided — reopening the assessment won't restart it. Use the Approval module if you need to revisit the decision."
      );
    }
  }
  await updateData(
    `
    UPDATE dbo.application_assessments
    SET stage = 'IN_REVIEW', recommendation = NULL, recommended_by = NULL, recommended_at = NULL,
        updated_by = @param1, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [asm.id, toInt(actorId)]
  );
  await logActivity(asm.id, "REOPENED", `Reopened from ${asm.stage}`, actorId);
  return getAssessmentDetail(applicationId);
}

function resolveChargeAmount(payload) {
  const explicit = toDecimal(payload?.amount);
  if (explicit !== null) return explicit;
  const qty = toDecimal(payload?.quantity);
  const rate = toDecimal(payload?.unit_rate);
  if (qty !== null && rate !== null) return Math.round(qty * rate * 100) / 100;
  return 0;
}

async function addCharge(applicationId, payload, actorId) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  const description = String(payload?.description ?? "").trim();
  if (!description) throw new Error("description is required");
  const amount = resolveChargeAmount(payload);

  const id = await runInTransaction(async (tx) => {
    const result = await tx.query(
      `
      INSERT INTO dbo.assessment_charges
        (assessment_id, charge_type, description, rate_basis, quantity, unit_rate, amount, remarks, created_by, created_at)
      OUTPUT INSERTED.id
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, SYSUTCDATETIME())
      `,
      [
        asm.id,
        pick(payload?.charge_type, CHARGE_TYPES, "OTHER"),
        description.slice(0, 500),
        payload?.rate_basis ? String(payload.rate_basis).slice(0, 100) : null,
        toDecimal(payload?.quantity),
        toDecimal(payload?.unit_rate),
        amount,
        payload?.remarks ? String(payload.remarks).slice(0, 500) : null,
        toInt(actorId),
      ]
    );
    await recomputeChargesTotal(asm.id, actorId, tx);
    return result?.recordset?.[0]?.id;
  });
  await logActivity(asm.id, "CHARGE_ADDED", `${description.slice(0, 120)} = ${amount}`, actorId);
  return getChargeById(id);
}

async function getChargeById(id) {
  const rows = await selectData(`SELECT * FROM dbo.assessment_charges WHERE id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

async function updateCharge(id, payload, actorId) {
  await ensureSchema();
  const existing = await getChargeById(id);
  if (!existing) return null;

  const merged = {
    quantity: payload?.quantity !== undefined ? payload.quantity : existing.quantity,
    unit_rate: payload?.unit_rate !== undefined ? payload.unit_rate : existing.unit_rate,
    amount: payload?.amount !== undefined ? payload.amount : undefined,
  };
  const amount = payload?.amount !== undefined || payload?.quantity !== undefined || payload?.unit_rate !== undefined
    ? resolveChargeAmount(merged)
    : existing.amount;

  await runInTransaction(async (tx) => {
    const sets = [];
    const params = [];
    const push = (frag, value) => {
      sets.push(frag.replace("?", `@param${params.length}`));
      params.push(value);
    };
    if (payload?.charge_type !== undefined) push("charge_type = ?", pick(payload.charge_type, CHARGE_TYPES, existing.charge_type));
    if (payload?.description !== undefined) {
      const d = String(payload.description ?? "").trim();
      if (!d) throw new Error("description cannot be empty");
      push("description = ?", d.slice(0, 500));
    }
    if (payload?.rate_basis !== undefined) push("rate_basis = ?", payload.rate_basis ? String(payload.rate_basis).slice(0, 100) : null);
    if (payload?.quantity !== undefined) push("quantity = ?", toDecimal(payload.quantity));
    if (payload?.unit_rate !== undefined) push("unit_rate = ?", toDecimal(payload.unit_rate));
    push("amount = ?", amount);
    if (payload?.remarks !== undefined) push("remarks = ?", payload.remarks ? String(payload.remarks).slice(0, 500) : null);
    push("updated_by = ?", toInt(actorId));
    const query = `UPDATE dbo.assessment_charges SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length}`;
    params.push(toInt(id));
    await tx.query(query, params);
    await recomputeChargesTotal(existing.assessment_id, actorId, tx);
  });
  await logActivity(existing.assessment_id, "CHARGE_UPDATED", `Charge #${id}`, actorId);
  return getChargeById(id);
}

async function deleteCharge(id, actorId) {
  await ensureSchema();
  const existing = await getChargeById(id);
  if (!existing) return false;
  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM dbo.assessment_charges WHERE id = @param0`, [toInt(id)]);
    await recomputeChargesTotal(existing.assessment_id, actorId, tx);
  });
  await logActivity(existing.assessment_id, "CHARGE_DELETED", `Charge #${id}`, actorId);
  return true;
}

async function submitRecommendation(applicationId, { recommendation, summary, actorId }) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  // The frontend disables the Submit button once a.recommendation is set,
  // but that's client-side only — without this, a direct API call can
  // overwrite an already-endorsed (and already-routed-to-Approval)
  // recommendation, leaving Approval's ladder going on a decision Assessment
  // no longer agrees with. Only Reopen (which clears recommendation) can
  // legitimately re-open this.
  if (asm.recommendation) {
    throw businessError("A recommendation has already been submitted for this assessment. An admin must reopen it first.");
  }
  const rec = pick(recommendation, RECOMMENDATIONS);
  if (!rec) throw new Error("Invalid recommendation");
  const note = String(summary ?? "").trim();

  const nextStage = "COMPLETED";
  // Same compare-and-swap reasoning as setStage — the recommendation===null
  // check above is a stale read, so the write itself re-checks it.
  const result = await updateData(
    `
    UPDATE dbo.application_assessments
    SET recommendation = @param1, recommendation_summary = @param2, recommended_by = @param3,
        recommended_at = SYSUTCDATETIME(), stage = @param4, updated_by = @param3, updated_at = SYSUTCDATETIME()
    WHERE id = @param0 AND recommendation IS NULL
    `,
    [asm.id, rec, note || null, toInt(actorId), nextStage]
  );
  if (!result?.rowsAffected?.[0]) {
    throw businessError("A recommendation has already been submitted for this assessment. An admin must reopen it first.");
  }
  await logActivity(asm.id, "RECOMMENDED", `${rec}${note ? `: ${note.slice(0, 200)}` : ""}`, actorId);

  // The recommendation write above already committed and is now locked (only
  // an admin Reopen can undo it), so these two follow-through steps can't be
  // allowed to fail silently — a swallowed error here used to leave the
  // assessment COMPLETED with the application stuck on its old status, or
  // FOR_APPROVAL with no approval_steps for the Account Officer to act on,
  // and no way to retry short of Reopen. They're collected as `warnings`
  // and returned to the caller instead, so the officer who just submitted
  // sees that something needs an admin's attention right away.
  const warnings = [];

  const targetStatus = rec === "DISAPPROVE" ? "DISAPPROVED" : "FOR_APPROVAL";
  try {
    await Workflow.updateApplicationStatus(applicationId, {
      to_status: targetStatus,
      remarks: note || `Assessment recommendation: ${rec}`,
      changed_by: toInt(actorId),
    });
  } catch (error) {
    console.error("submitRecommendation: application status update failed:", error);
    warnings.push(
      `The recommendation was saved, but the application's status could not be updated to ${targetStatus} (${error.message || "unknown error"}). An admin needs to fix this.`
    );
  }

  if (targetStatus === "FOR_APPROVAL") {
    try {
      // Lazy require — ApprovalIssuance.js requires this module too (for
      // CHARGE_TYPES/addCharge/etc.), so a top-level require here would be
      // circular. Auto-starts the routing ladder the moment Assessment
      // endorses, so the Account Officer never has to click "Start approval
      // routing" themselves — Level 1 is already PENDING when they open it.
      const ApprovalIssuance = require("./ApprovalIssuance");
      await ApprovalIssuance.startApproval(applicationId, actorId);
    } catch (error) {
      console.error("submitRecommendation: auto-start approval failed:", error);
      warnings.push(
        `The recommendation was saved, but approval routing could not be started (${error.message || "unknown error"}). An admin needs to start it manually or fix the approval-level configuration.`
      );
    }
  }

  const detail = await getAssessmentDetail(applicationId);
  return warnings.length ? { ...detail, warnings } : detail;
}

module.exports = {
  ensureSchema,
  STAGES,
  CHARGE_TYPES,
  RECOMMENDATIONS,
  getOrCreateAssessment,
  logRequirementActivity,
  listAssessments,
  getSummary,
  listAssignableEvaluators,
  getAssessmentDetail,
  assignEvaluator,
  setStage,
  reopen,
  addCharge,
  updateCharge,
  deleteCharge,
  getChargeById,
  submitRecommendation,
};
