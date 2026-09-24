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
const Role = require("./Role");

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

    -- Two-level review: the Level 2 Officer's recommendation (officer_*)
    -- is held for the Level 1 Manager, whose own decision is the final
    -- recommendation/recommended_* above. approver_id is the Account Officer
    -- the Manager picked to take the approval.
    IF COL_LENGTH('dbo.application_assessments', 'officer_recommendation') IS NULL
      ALTER TABLE dbo.application_assessments ADD
        officer_recommendation NVARCHAR(20) NULL,
        officer_recommendation_summary NVARCHAR(2000) NULL,
        officer_recommended_by INT NULL,
        officer_recommended_at DATETIME2(3) NULL;
    IF COL_LENGTH('dbo.application_assessments', 'approver_id') IS NULL
      ALTER TABLE dbo.application_assessments ADD approver_id INT NULL;
  `);

  // Assigned/In Review need an evaluator — rows moved there by hand before
  // that rule existed go back to Unassigned. No-op once clean.
  await updateSchema(`
    UPDATE dbo.application_assessments
    SET stage = 'UNASSIGNED'
    WHERE assigned_evaluator_id IS NULL AND stage IN ('ASSIGNED', 'IN_REVIEW');
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
    asm.recommendation_summary,
    asm.recommended_at,
    rb.full_name AS recommended_by_name,
    asm.officer_recommendation,
    asm.officer_recommendation_summary,
    asm.officer_recommended_at,
    ob.full_name AS officer_recommended_by_name,
    asm.approver_id,
    apv.full_name AS approver_name,
    apv.username AS approver_username,
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
  LEFT JOIN dbo.users rb ON rb.id = asm.recommended_by
  LEFT JOIN dbo.users ob ON ob.id = asm.officer_recommended_by
  LEFT JOIN dbo.users apv ON apv.id = asm.approver_id
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

/** `evaluatorId` scopes every count to one evaluator's assignments — used
 * for a Level 2 Officer, whose stat bar should reflect only their own work. */
async function getSummary({ evaluatorId } = {}) {
  await ensureSchema();
  const evId = toInt(evaluatorId);
  const evFilter = evId ? "AND asm.assigned_evaluator_id = @param0" : "";
  const stageRows = await selectData(
    `
    SELECT ISNULL(asm.stage, 'UNASSIGNED') AS stage, COUNT(1) AS total
    FROM dbo.applications a
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
    WHERE (a.status NOT IN ('DRAFT', 'REJECTED') OR asm.id IS NOT NULL) ${evFilter}
    GROUP BY ISNULL(asm.stage, 'UNASSIGNED')
    `,
    evId ? [evId] : []
  );
  const byStage = {};
  STAGES.forEach((s) => { byStage[s] = 0; });
  stageRows.forEach((r) => { byStage[String(r.stage)] = Number(r.total || 0); });

  const overdueRows = await selectData(
    `
    SELECT COUNT(1) AS total
    FROM dbo.application_assessments asm
    WHERE asm.stage IN ('ASSIGNED', 'IN_REVIEW', 'FOR_RECOMMENDATION')
      AND asm.assigned_at IS NOT NULL
      AND DATEDIFF(DAY, asm.assigned_at, SYSUTCDATETIME()) > @param${evId ? 1 : 0}
      ${evFilter}
    `,
    evId ? [evId, OVERDUE_DAYS] : [OVERDUE_DAYS]
  );

  const avgRows = await selectData(
    `
    SELECT AVG(CAST(DATEDIFF(DAY, asm.assigned_at, asm.recommended_at) AS FLOAT)) AS avg_days
    FROM dbo.application_assessments asm
    WHERE asm.recommended_at IS NOT NULL AND asm.assigned_at IS NOT NULL ${evFilter}
    `,
    evId ? [evId] : []
  );

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
async function listUsersWithMenu(menuKey) {
  await ensureSchema();
  await ControlPanelPermission.ensureSchema();
  return selectData(
    `
    SELECT DISTINCT u.id, u.full_name, u.username
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id
    LEFT JOIN dbo.role_sidebar_menu_permissions p
      ON p.role_id = r.id AND p.menu_key = @param0 AND p.is_enabled = 1
    WHERE u.is_active = 1
      AND (LOWER(LTRIM(RTRIM(r.name))) = 'admin' OR p.role_id IS NOT NULL)
    ORDER BY u.full_name
    `,
    [menuKey]
  );
}

async function listAssignableEvaluators() {
  return listUsersWithMenu("assessment:queue");
}

/** Who a Manager can hand an endorsed application to for approval — anyone
 * with approval:queue (conventionally the Account Officer), plus admin. */
async function listAssignableApprovers() {
  return listUsersWithMenu("approval:queue");
}

/** The user's Assessment level (users.assessment_level, set per account in
 * User Management): 1 = Manager, anything else = Level 2 Officer. */
async function getUserLevel(userId) {
  const rows = await selectData(`SELECT TOP (1) assessment_level FROM dbo.users WHERE id = @param0`, [toInt(userId)]);
  return Number(rows?.[0]?.assessment_level) === 1 ? 1 : 2;
}

/** Level 1 (Manager) check for the signed-in user: admin, or an account set
 * to Level 1. Everyone else who got past the assessment:queue route guard is
 * a Level 2 Officer. */
async function isManager(user) {
  const role = String(user?.role || "").trim().toLowerCase();
  if (role === "admin") return true;
  if (!user?.id) return false;
  return (await getUserLevel(user.id)) === 1;
}

function hasEnabledMenu(sidebarRows, menuKey) {
  return (sidebarRows || []).some(
    (p) => p.menu_key === menuKey && (Number(p.is_enabled) === 1 || p.is_enabled === true)
  );
}

/** A Level 2 Officer whose applications view should be limited to their own
 * assignments: Evaluation Queue access, not Level 1, and not also an
 * approver (approval:queue is its own, separate door to applications). */
async function isScopedLevel2(userId, sidebarRows) {
  if (!hasEnabledMenu(sidebarRows, "assessment:queue")) return false;
  if (hasEnabledMenu(sidebarRows, "approval:queue")) return false;
  return (await getUserLevel(userId)) !== 1;
}

/** For the app-wide application endpoints (/api/applications, document
 * download): returns the user id to scope to when the caller is a Level 2
 * Officer, so they see just their own assignments there too — even if
 * their role also shows New Applications/Renewals, since Level 1 and Level 2
 * share one role. null means unrestricted (admin, a Manager, an approver) or
 * not staff at all — the existing route guards/ownership checks still decide
 * that part. */
async function getLevel2OnlyUserId(user) {
  const role = String(user?.role || "").trim().toLowerCase();
  if (!role || role === "admin" || role === "proponent") return null;
  const roleId = await Role.getActiveRoleIdByName(user?.role);
  if (!roleId) return null;
  const rows = await ControlPanelPermission.getSidebarPermissions(roleId);
  return (await isScopedLevel2(user?.id, rows)) ? toInt(user?.id) : null;
}

async function listApplicationIdsAssignedTo(userId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT application_id FROM dbo.application_assessments WHERE assigned_evaluator_id = @param0`,
    [toInt(userId)]
  );
  return new Set(rows.map((r) => toInt(r.application_id)));
}

async function getAssignedEvaluatorId(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT TOP (1) assigned_evaluator_id FROM dbo.application_assessments WHERE application_id = @param0`,
    [toInt(applicationId)]
  );
  return toInt(rows?.[0]?.assigned_evaluator_id);
}

async function getApplicationIdForCharge(chargeId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1) asm.application_id
    FROM dbo.assessment_charges c
    INNER JOIN dbo.application_assessments asm ON asm.id = c.assessment_id
    WHERE c.id = @param0
    `,
    [toInt(chargeId)]
  );
  return toInt(rows?.[0]?.application_id);
}

async function getApplicationIdForRequirement(applicationRequirementId) {
  const rows = await selectData(
    `SELECT TOP (1) application_id FROM dbo.application_requirements WHERE id = @param0`,
    [toInt(applicationRequirementId)]
  );
  return toInt(rows?.[0]?.application_id);
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
  // Only the working stages are moved by hand — FOR_RECOMMENDATION is reached
  // by the Officer submitting their review, and left by the Manager's final
  // decision or Return to Officer; COMPLETED/RETURNED by the final decision.
  const next = pick(stage, ["ASSIGNED", "IN_REVIEW"]);
  if (!next) throw new Error("Invalid stage");
  if (asm.stage === "FOR_RECOMMENDATION") {
    throw businessError("This assessment is waiting for the Manager's recommendation — the Manager can return it to the officer.");
  }
  if (!asm.assigned_evaluator_id) {
    throw businessError("Assign an evaluator first.");
  }
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
    WHERE id = @param0 AND stage NOT IN ('COMPLETED', 'RETURNED', 'FOR_RECOMMENDATION')
      AND assigned_evaluator_id IS NOT NULL
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
        officer_recommendation = NULL, officer_recommendation_summary = NULL,
        officer_recommended_by = NULL, officer_recommended_at = NULL,
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

async function userName(userId) {
  const rows = await selectData(`SELECT TOP (1) full_name, username FROM dbo.users WHERE id = @param0`, [toInt(userId)]);
  return rows?.[0]?.full_name || rows?.[0]?.username || `User #${userId}`;
}

/** Level 2 Officer finishes the compliance review and sends their
 * recommendation up to the Level 1 Manager (stage → FOR_RECOMMENDATION).
 * Nothing about the application itself changes yet — the Manager's
 * submitRecommendation below is the decision that counts. */
async function submitOfficerReview(applicationId, { recommendation, summary, actorId }) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  if (!asm.assigned_evaluator_id) throw businessError("Assign an evaluator before submitting a review.");
  if (!["ASSIGNED", "IN_REVIEW"].includes(asm.stage)) {
    throw businessError("This review has already been submitted to the Manager.");
  }
  const rec = pick(recommendation, RECOMMENDATIONS);
  if (!rec) throw new Error("Invalid recommendation");
  const note = String(summary ?? "").trim();

  const result = await updateData(
    `
    UPDATE dbo.application_assessments
    SET officer_recommendation = @param1, officer_recommendation_summary = @param2,
        officer_recommended_by = @param3, officer_recommended_at = SYSUTCDATETIME(),
        stage = 'FOR_RECOMMENDATION', updated_by = @param3, updated_at = SYSUTCDATETIME()
    WHERE id = @param0 AND stage IN ('ASSIGNED', 'IN_REVIEW')
    `,
    [asm.id, rec, note || null, toInt(actorId)]
  );
  if (!result?.rowsAffected?.[0]) {
    throw businessError("This review has already been submitted to the Manager.");
  }
  await logActivity(asm.id, "OFFICER_RECOMMENDED", `${rec}${note ? `: ${note.slice(0, 200)}` : ""}`, actorId);

  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `For recommendation: ${app?.application_no || ""}`.trim(),
    body: `${await userName(actorId)} finished reviewing application ${app?.application_no || ""} (${rec}) — it's waiting for the Manager's recommendation.`,
  });
  return getAssessmentDetail(applicationId);
}

/** Level 1 Manager sends a submitted review back to the assigned officer to
 * redo (stage → IN_REVIEW, officer's recommendation cleared). */
async function returnToOfficer(applicationId, { note, actorId }) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  const text = String(note ?? "").trim();
  const result = await updateData(
    `
    UPDATE dbo.application_assessments
    SET stage = 'IN_REVIEW', officer_recommendation = NULL, officer_recommendation_summary = NULL,
        officer_recommended_by = NULL, officer_recommended_at = NULL,
        updated_by = @param1, updated_at = SYSUTCDATETIME()
    WHERE id = @param0 AND stage = 'FOR_RECOMMENDATION'
    `,
    [asm.id, toInt(actorId)]
  );
  if (!result?.rowsAffected?.[0]) {
    throw businessError("Only a review waiting for the Manager's recommendation can be returned to the officer.");
  }
  await logActivity(asm.id, "RETURNED_TO_OFFICER", text ? text.slice(0, 1000) : null, actorId);

  const app = await getApplicationRow(applicationId);
  await notify({
    applicationId,
    actorId,
    subject: `Returned for review: ${app?.application_no || ""}`.trim(),
    body: `The Manager returned application ${app?.application_no || ""} for further review${text ? `: ${text.slice(0, 300)}` : "."}`,
  });
  return getAssessmentDetail(applicationId);
}

/** Level 1 Manager's final recommendation on the Officer's review. ENDORSE
 * (Approve) sends the application to Approval, assigned to the Account
 * Officer in `approverId`; DISAPPROVE closes it as DISAPPROVED. */
async function submitRecommendation(applicationId, { recommendation, summary, approverId, actorId }) {
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
  if (asm.stage !== "FOR_RECOMMENDATION") {
    throw businessError("The assigned officer must submit their review before the Manager's recommendation.");
  }
  const rec = pick(recommendation, RECOMMENDATIONS);
  if (!rec) throw new Error("Invalid recommendation");
  const note = String(summary ?? "").trim();

  let approver = null;
  if (rec === "ENDORSE") {
    const apId = toInt(approverId);
    if (!apId) throw businessError("Choose the Account Officer who will handle the approval.");
    approver = (await listAssignableApprovers()).find((u) => Number(u.id) === apId) || null;
    if (!approver) throw businessError("The selected Account Officer can't take approvals.");
  }

  const nextStage = "COMPLETED";
  // Same compare-and-swap reasoning as setStage — the recommendation===null
  // check above is a stale read, so the write itself re-checks it.
  const result = await updateData(
    `
    UPDATE dbo.application_assessments
    SET recommendation = @param1, recommendation_summary = @param2, recommended_by = @param3,
        recommended_at = SYSUTCDATETIME(), stage = @param4, approver_id = @param5,
        updated_by = @param3, updated_at = SYSUTCDATETIME()
    WHERE id = @param0 AND recommendation IS NULL AND stage = 'FOR_RECOMMENDATION'
    `,
    [asm.id, rec, note || null, toInt(actorId), nextStage, approver ? toInt(approver.id) : null]
  );
  if (!result?.rowsAffected?.[0]) {
    throw businessError("A recommendation has already been submitted for this assessment. An admin must reopen it first.");
  }
  const approverName = approver ? approver.full_name || approver.username : null;
  await logActivity(
    asm.id,
    "RECOMMENDED",
    `${rec}${approverName ? ` → ${approverName}` : ""}${note ? `: ${note.slice(0, 200)}` : ""}`,
    actorId
  );

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
      // circular. Auto-starts approval the moment Assessment endorses, so
      // the approving officer never has to click "Start approval" themselves
      // — it's already PENDING when they open it.
      const ApprovalIssuance = require("./ApprovalIssuance");
      await ApprovalIssuance.startApproval(applicationId, actorId, { assignTo: approver?.id });
    } catch (error) {
      console.error("submitRecommendation: auto-start approval failed:", error);
      warnings.push(
        `The recommendation was saved, but approval could not be started (${error.message || "unknown error"}). An admin needs to start it manually.`
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
  isManager,
  isScopedLevel2,
  getLevel2OnlyUserId,
  listApplicationIdsAssignedTo,
  getAssignedEvaluatorId,
  getApplicationIdForCharge,
  getApplicationIdForRequirement,
  getOrCreateAssessment,
  logRequirementActivity,
  listAssessments,
  getSummary,
  listAssignableEvaluators,
  listAssignableApprovers,
  getAssessmentDetail,
  assignEvaluator,
  setStage,
  reopen,
  addCharge,
  updateCharge,
  deleteCharge,
  getChargeById,
  submitOfficerReview,
  returnToOfficer,
  submitRecommendation,
};
