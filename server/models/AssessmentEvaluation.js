const {
  selectData,
  insertData,
  updateData,
  updateSchema,
  runInTransaction,
} = require("../config/database");
const Notification = require("./Notification");
const Workflow = require("./ApplicationWorkflow");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

const FINDING_TYPES = ["FINDING", "COMMENT", "REMARK", "DEFICIENCY", "RECOMMENDATION"];
const FINDING_CATEGORIES = ["DOCUMENTARY", "REGULATORY", "FINANCIAL", "TECHNICAL", "OTHER"];
const FINDING_STATUSES = ["OPEN", "RESOLVED", "WAIVED"];
const FINDING_SEVERITIES = ["LOW", "MEDIUM", "HIGH"];
const CHARGE_TYPES = ["RENTAL", "PROCESSING_FEE", "TAX", "PENALTY", "OTHER"];
const RECOMMENDATIONS = ["ENDORSE", "RETURN", "DISAPPROVE"];

/** Days after assignment before an in-progress assessment counts as overdue. */
const OVERDUE_DAYS = 5;

function pick(value, allowed, fallback = null) {
  const v = String(value ?? "").trim().toUpperCase();
  return allowed.includes(v) ? v : fallback;
}

async function ensureSchema() {
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

    IF OBJECT_ID('dbo.assessment_findings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.assessment_findings (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        assessment_id INT NOT NULL,
        finding_type NVARCHAR(20) NOT NULL CONSTRAINT DF_assessment_findings_type DEFAULT ('FINDING'),
        category NVARCHAR(20) NOT NULL CONSTRAINT DF_assessment_findings_category DEFAULT ('DOCUMENTARY'),
        severity NVARCHAR(10) NULL,
        requirement_id INT NULL,
        description NVARCHAR(2000) NOT NULL,
        status NVARCHAR(15) NOT NULL CONSTRAINT DF_assessment_findings_status DEFAULT ('OPEN'),
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_assessment_findings_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_assessment_findings_assessment_id ON dbo.assessment_findings(assessment_id);
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
    ISNULL(asm.charges_total, 0) AS charges_total,
    CASE WHEN asm.assigned_at IS NULL THEN NULL
      ELSE DATEDIFF(DAY, asm.assigned_at, SYSUTCDATETIME()) END AS days_in_assessment,
    (SELECT COUNT(1) FROM dbo.assessment_findings f WHERE f.assessment_id = asm.id) AS total_findings,
    (SELECT COUNT(1) FROM dbo.assessment_findings f WHERE f.assessment_id = asm.id AND f.status = 'OPEN') AS open_findings,
    (SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id) AS requirements_total,
    (SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id AND ar.status = 'VERIFIED') AS requirements_verified
  FROM dbo.applications a
  LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
  LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
  LEFT JOIN dbo.users ev ON ev.id = asm.assigned_evaluator_id
`;

async function listAssessments({ stage, evaluatorId, search } = {}) {
  await ensureSchema();
  const where = [];
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
  return selectData(sql, params);
}

async function getSummary() {
  await ensureSchema();
  const stageRows = await selectData(`
    SELECT ISNULL(asm.stage, 'UNASSIGNED') AS stage, COUNT(1) AS total
    FROM dbo.applications a
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
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

async function listAssignableEvaluators() {
  await ensureSchema();
  return selectData(`
    SELECT DISTINCT u.id, u.full_name, u.username
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id
    WHERE u.is_active = 1
      AND LOWER(LTRIM(RTRIM(r.name))) IN ('admin', 'administrator', 'officer', 'account officer')
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
  const findings = assessmentId
    ? await selectData(
        `
        SELECT f.*, r.code AS requirement_code, r.name AS requirement_name
        FROM dbo.assessment_findings f
        LEFT JOIN dbo.requirements r ON r.id = f.requirement_id
        WHERE f.assessment_id = @param0
        ORDER BY f.id DESC
        `,
        [assessmentId]
      )
    : [];
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

  return { assessment: header, findings, charges, activity, requirements, documents };
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
  await updateData(
    `
    UPDATE dbo.application_assessments
    SET stage = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [asm.id, next, toInt(actorId)]
  );
  await logActivity(asm.id, "STAGE_CHANGED", `${asm.stage} → ${next}`, actorId);
  return getAssessmentDetail(applicationId);
}

async function reopen(applicationId, actorId) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
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

async function addFinding(applicationId, payload, actorId) {
  const asm = await getOrCreateAssessment(applicationId, actorId);
  if (!asm) return null;
  const description = String(payload?.description ?? "").trim();
  if (!description) throw new Error("description is required");

  const result = await insertData(
    `
    INSERT INTO dbo.assessment_findings
      (assessment_id, finding_type, category, severity, requirement_id, description, status, created_by, created_at)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, SYSUTCDATETIME())
    `,
    [
      asm.id,
      pick(payload?.finding_type, FINDING_TYPES, "FINDING"),
      pick(payload?.category, FINDING_CATEGORIES, "DOCUMENTARY"),
      pick(payload?.severity, FINDING_SEVERITIES),
      toInt(payload?.requirement_id),
      description.slice(0, 2000),
      pick(payload?.status, FINDING_STATUSES, "OPEN"),
      toInt(actorId),
    ]
  );
  const id = result?.recordset?.[0]?.id;
  await logActivity(asm.id, "FINDING_ADDED", description.slice(0, 200), actorId);

  const type = pick(payload?.finding_type, FINDING_TYPES, "FINDING");
  if (type === "DEFICIENCY") {
    const app = await getApplicationRow(applicationId);
    await notify({
      applicationId,
      actorId,
      subject: `Deficiency noted: ${app?.application_no || ""}`.trim(),
      body: `A deficiency was recorded during assessment of ${app?.application_no || ""}: ${description.slice(0, 300)}`,
    });
  }
  return getFindingById(id);
}

async function getFindingById(id) {
  const rows = await selectData(
    `
    SELECT f.*, r.code AS requirement_code, r.name AS requirement_name
    FROM dbo.assessment_findings f
    LEFT JOIN dbo.requirements r ON r.id = f.requirement_id
    WHERE f.id = @param0
    `,
    [toInt(id)]
  );
  return rows?.[0] || null;
}

async function updateFinding(id, payload, actorId) {
  await ensureSchema();
  const existing = await getFindingById(id);
  if (!existing) return null;
  const sets = [];
  const params = [];
  const push = (frag, value) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (payload?.finding_type !== undefined) push("finding_type = ?", pick(payload.finding_type, FINDING_TYPES, existing.finding_type));
  if (payload?.category !== undefined) push("category = ?", pick(payload.category, FINDING_CATEGORIES, existing.category));
  if (payload?.severity !== undefined) push("severity = ?", pick(payload.severity, FINDING_SEVERITIES));
  if (payload?.requirement_id !== undefined) push("requirement_id = ?", toInt(payload.requirement_id));
  if (payload?.description !== undefined) {
    const d = String(payload.description ?? "").trim();
    if (!d) throw new Error("description cannot be empty");
    push("description = ?", d.slice(0, 2000));
  }
  if (payload?.status !== undefined) push("status = ?", pick(payload.status, FINDING_STATUSES, existing.status));
  push("updated_by = ?", toInt(actorId));
  const query = `UPDATE dbo.assessment_findings SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length}`;
  params.push(toInt(id));
  await updateData(query, params);
  await logActivity(existing.assessment_id, "FINDING_UPDATED", `Finding #${id}`, actorId);
  return getFindingById(id);
}

async function deleteFinding(id, actorId) {
  await ensureSchema();
  const existing = await getFindingById(id);
  if (!existing) return false;
  await updateData(`DELETE FROM dbo.assessment_findings WHERE id = @param0`, [toInt(id)]);
  await logActivity(existing.assessment_id, "FINDING_DELETED", `Finding #${id}`, actorId);
  return true;
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
  const rec = pick(recommendation, RECOMMENDATIONS);
  if (!rec) throw new Error("Invalid recommendation");
  const note = String(summary ?? "").trim();

  const nextStage = rec === "RETURN" ? "RETURNED" : "COMPLETED";
  await updateData(
    `
    UPDATE dbo.application_assessments
    SET recommendation = @param1, recommendation_summary = @param2, recommended_by = @param3,
        recommended_at = SYSUTCDATETIME(), stage = @param4, updated_by = @param3, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [asm.id, rec, note || null, toInt(actorId), nextStage]
  );
  await logActivity(asm.id, "RECOMMENDED", `${rec}${note ? `: ${note.slice(0, 200)}` : ""}`, actorId);

  const targetStatus = rec === "RETURN" ? "RETURNED" : rec === "DISAPPROVE" ? "DISAPPROVED" : "FOR_APPROVAL";
  try {
    await Workflow.updateApplicationStatus(applicationId, {
      to_status: targetStatus,
      remarks: note || `Assessment recommendation: ${rec}`,
      changed_by: toInt(actorId),
    });
  } catch (error) {
    console.error("submitRecommendation: application status update failed:", error);
  }

  return getAssessmentDetail(applicationId);
}

module.exports = {
  ensureSchema,
  STAGES,
  FINDING_TYPES,
  FINDING_CATEGORIES,
  FINDING_STATUSES,
  CHARGE_TYPES,
  RECOMMENDATIONS,
  getOrCreateAssessment,
  listAssessments,
  getSummary,
  listAssignableEvaluators,
  getAssessmentDetail,
  assignEvaluator,
  setStage,
  reopen,
  addFinding,
  updateFinding,
  deleteFinding,
  addCharge,
  updateCharge,
  deleteCharge,
  submitRecommendation,
};
