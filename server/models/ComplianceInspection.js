const {
  selectData,
  insertData,
  updateData,
  updateSchema,
  runInTransaction,
} = require("../config/database");
const Notification = require("./Notification");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const RESULTS = ["PASSED", "PASSED_WITH_FINDINGS", "FAILED"];
const FINDING_SEVERITIES = ["LOW", "MEDIUM", "HIGH"];
const FINDING_STATUSES = ["OPEN", "RESOLVED", "WAIVED"];
const ACTION_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "OVERDUE"];
const DOC_KINDS = ["REPORT", "SUPPORTING"];

/** TOR Module 10 inspection coverage — seeded into inspection_types if missing. */
const SEED_INSPECTION_TYPES = [
  ["PERF_COMMITMENT", "Performance Commitment"],
  ["COMPLIANCE", "Compliance Inspection"],
  ["AUDIT", "Audit Inspection"],
  ["ENGINEERING", "Engineering Inspection"],
  ["PROPERTY", "Property Inspection"],
  ["MARKETING", "Marketing Inspection"],
  ["SAFETY", "Safety Inspection"],
  ["SECURITY", "Security Inspection"],
  ["LEGAL", "Legal Inspection"],
];

function pick(value, allowed, fallback = null) {
  const v = String(value ?? "").trim().toUpperCase();
  return allowed.includes(v) ? v : fallback;
}

let schemaReady = false;
let typesSeeded = false;

async function ensureSchema() {
  if (schemaReady) {
    if (!typesSeeded) await seedInspectionTypes();
    return;
  }
  await updateSchema(`
    IF OBJECT_ID('dbo.inspections', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.inspections (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        contract_id INT NULL,
        application_id INT NULL,
        inspection_type_id INT NULL,
        inspection_type_code NVARCHAR(50) NULL,
        title NVARCHAR(255) NOT NULL,
        scheduled_date DATE NULL,
        conducted_date DATE NULL,
        assigned_inspector_id INT NULL,
        assigned_by INT NULL,
        assigned_at DATETIME2(3) NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_inspections_status DEFAULT ('SCHEDULED'),
        result NVARCHAR(25) NULL,
        summary NVARCHAR(2000) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inspections_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_inspections_proponent_id ON dbo.inspections(proponent_id);
      CREATE INDEX IX_inspections_status ON dbo.inspections(status);
      CREATE INDEX IX_inspections_inspector ON dbo.inspections(assigned_inspector_id);
    END;

    IF OBJECT_ID('dbo.inspection_findings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.inspection_findings (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        inspection_id INT NOT NULL,
        category NVARCHAR(60) NULL,
        severity NVARCHAR(10) NULL,
        description NVARCHAR(2000) NOT NULL,
        recommendation NVARCHAR(2000) NULL,
        status NVARCHAR(15) NOT NULL CONSTRAINT DF_inspection_findings_status DEFAULT ('OPEN'),
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inspection_findings_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_inspection_findings_inspection_id ON dbo.inspection_findings(inspection_id);
    END;

    IF OBJECT_ID('dbo.inspection_corrective_actions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.inspection_corrective_actions (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        inspection_id INT NOT NULL,
        finding_id INT NULL,
        action_required NVARCHAR(2000) NOT NULL,
        responsible_party NVARCHAR(255) NULL,
        due_date DATE NULL,
        status NVARCHAR(15) NOT NULL CONSTRAINT DF_inspection_ca_status DEFAULT ('PENDING'),
        completed_date DATE NULL,
        remarks NVARCHAR(1000) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inspection_ca_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_inspection_ca_inspection_id ON dbo.inspection_corrective_actions(inspection_id);
    END;

    IF OBJECT_ID('dbo.inspection_documents', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.inspection_documents (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        inspection_id INT NOT NULL,
        doc_kind NVARCHAR(15) NOT NULL CONSTRAINT DF_inspection_documents_kind DEFAULT ('SUPPORTING'),
        file_name NVARCHAR(260) NOT NULL,
        original_file_name NVARCHAR(260) NULL,
        storage_path NVARCHAR(1000) NOT NULL,
        content_type NVARCHAR(255) NULL,
        file_size_bytes BIGINT NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inspection_documents_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_inspection_documents_inspection_id ON dbo.inspection_documents(inspection_id);
    END;

    IF OBJECT_ID('dbo.inspection_activity', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.inspection_activity (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        inspection_id INT NOT NULL,
        action NVARCHAR(40) NOT NULL,
        detail NVARCHAR(1000) NULL,
        actor_id INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inspection_activity_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_inspection_activity_inspection_id ON dbo.inspection_activity(inspection_id);
    END;
  `);
  schemaReady = true;
  await seedInspectionTypes();
}

/**
 * Adds the TOR inspection types to dbo.inspection_types if missing. Runs at most
 * once per process. The live table sometimes has `created_by` NOT NULL, so we
 * always pass a real user id (falls back to any existing user).
 */
async function seedInspectionTypes() {
  if (typesSeeded) return;
  try {
    await updateSchema(`
      IF OBJECT_ID('dbo.inspection_types', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.inspection_types (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          code NVARCHAR(50) NOT NULL,
          name NVARCHAR(255) NOT NULL,
          description NVARCHAR(1000) NULL,
          created_by INT NULL,
          updated_by INT NULL,
          created_at DATETIME2(3) NOT NULL DEFAULT (SYSUTCDATETIME()),
          updated_at DATETIME2(3) NULL,
          is_active BIT NOT NULL DEFAULT (1)
        );
      END
    `);
    // Only seed a fresh install. If the deployment already manages its own
    // inspection types, leave them alone.
    const existing = await selectData(`SELECT COUNT(1) AS n FROM dbo.inspection_types`);
    if (Number(existing?.[0]?.n || 0) === 0) {
      const sysUser = await selectData(`SELECT TOP (1) id FROM dbo.users ORDER BY id`);
      const uid = toInt(sysUser?.[0]?.id);
      for (const [code, name] of SEED_INSPECTION_TYPES) {
        await insertData(
          `
          INSERT INTO dbo.inspection_types (code, name, description, is_active, created_at, created_by)
          VALUES (@param0, @param1, NULL, 1, SYSUTCDATETIME(), @param2)
          `,
          [code, name, uid]
        );
      }
    }
    typesSeeded = true;
  } catch (error) {
    // Non-fatal — the module still works with whatever types already exist.
    typesSeeded = true;
    console.error("Seed inspection types skipped:", error.message || error);
  }
}

async function logActivity(inspectionId, action, detail, actorId) {
  try {
    await insertData(
      `
      INSERT INTO dbo.inspection_activity (inspection_id, action, detail, actor_id, created_at)
      VALUES (@param0, @param1, @param2, @param3, SYSUTCDATETIME())
      `,
      [toInt(inspectionId), String(action).slice(0, 40), detail ? String(detail).slice(0, 1000) : null, toInt(actorId)]
    );
  } catch (error) {
    console.error("Log inspection activity error:", error);
  }
}

async function notifyProponentScoped({ inspection, subject, body, actorId }) {
  // Inspections may not be tied to an application; only push app-scoped
  // notifications when we have an application_id to hang them on.
  const appId = toInt(inspection?.application_id);
  if (!appId) return;
  try {
    await Notification.createApplicationScopedNotifications({
      applicationId: appId,
      actorId,
      eventType: "compliance",
      subject,
      body,
    });
  } catch (error) {
    console.error("Inspection notification error:", error);
  }
}

const LIST_SELECT = `
  SELECT
    i.id,
    i.proponent_id,
    p.business_name AS proponent_name,
    i.contract_id,
    i.application_id,
    i.inspection_type_id,
    i.inspection_type_code,
    it.name AS inspection_type_name,
    i.title,
    i.scheduled_date,
    i.conducted_date,
    i.assigned_inspector_id,
    ins.full_name AS inspector_name,
    ins.username AS inspector_username,
    i.assigned_at,
    i.status,
    i.result,
    i.created_at,
    i.updated_at,
    (SELECT COUNT(1) FROM dbo.inspection_findings f WHERE f.inspection_id = i.id) AS total_findings,
    (SELECT COUNT(1) FROM dbo.inspection_findings f WHERE f.inspection_id = i.id AND f.status = 'OPEN') AS open_findings,
    (SELECT COUNT(1) FROM dbo.inspection_corrective_actions c WHERE c.inspection_id = i.id AND c.status <> 'DONE') AS open_actions,
    (SELECT COUNT(1) FROM dbo.inspection_corrective_actions c
      WHERE c.inspection_id = i.id AND c.status <> 'DONE'
        AND c.due_date IS NOT NULL AND c.due_date < CAST(SYSUTCDATETIME() AS DATE)) AS overdue_actions
  FROM dbo.inspections i
  LEFT JOIN dbo.proponents p ON p.id = i.proponent_id
  LEFT JOIN dbo.inspection_types it ON it.id = i.inspection_type_id
  LEFT JOIN dbo.users ins ON ins.id = i.assigned_inspector_id
`;

async function listInspections({ status, result, typeId, inspectorId, proponentId, search } = {}) {
  await ensureSchema();
  const where = [];
  const params = [];
  const add = (frag, value) => {
    where.push(frag.replace(/\?/g, `@param${params.length}`));
    params.push(value);
  };
  const st = pick(status, STATUSES);
  if (st) add("i.status = ?", st);
  const rs = pick(result, RESULTS);
  if (rs) add("i.result = ?", rs);
  const tId = toInt(typeId);
  if (tId) add("i.inspection_type_id = ?", tId);
  const insId = toInt(inspectorId);
  if (insId) add("i.assigned_inspector_id = ?", insId);
  const pId = toInt(proponentId);
  if (pId) add("i.proponent_id = ?", pId);
  const term = String(search ?? "").trim();
  if (term) {
    where.push(`(i.title LIKE @param${params.length} OR p.business_name LIKE @param${params.length})`);
    params.push(`%${term}%`);
  }
  const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY
    CASE i.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'SCHEDULED' THEN 1 WHEN 'COMPLETED' THEN 2 ELSE 3 END,
    ISNULL(i.scheduled_date, '9999-12-31') ASC, i.id DESC`;
  return selectData(sql, params);
}

async function getInspectionById(id) {
  const rows = await selectData(`${LIST_SELECT} WHERE i.id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

async function getInspectionDetail(id) {
  await ensureSchema();
  const header = await getInspectionById(id);
  if (!header) return null;
  const iid = toInt(id);
  const [findings, actions, documents, activity] = await Promise.all([
    selectData(`SELECT * FROM dbo.inspection_findings WHERE inspection_id = @param0 ORDER BY id DESC`, [iid]),
    selectData(
      `
      SELECT c.*, f.description AS finding_description
      FROM dbo.inspection_corrective_actions c
      LEFT JOIN dbo.inspection_findings f ON f.id = c.finding_id
      WHERE c.inspection_id = @param0
      ORDER BY ISNULL(c.due_date, '9999-12-31') ASC, c.id DESC
      `,
      [iid]
    ),
    selectData(`SELECT * FROM dbo.inspection_documents WHERE inspection_id = @param0 ORDER BY id DESC`, [iid]),
    selectData(
      `
      SELECT a.*, u.full_name AS actor_name, u.username AS actor_username
      FROM dbo.inspection_activity a
      LEFT JOIN dbo.users u ON u.id = a.actor_id
      WHERE a.inspection_id = @param0
      ORDER BY a.id DESC
      `,
      [iid]
    ),
  ]);
  return { inspection: header, findings, corrective_actions: actions, documents, activity };
}

async function getComplianceSummary() {
  await ensureSchema();
  const statusRows = await selectData(
    `SELECT status, COUNT(1) AS total FROM dbo.inspections GROUP BY status`
  );
  const byStatus = {};
  STATUSES.forEach((s) => { byStatus[s] = 0; });
  statusRows.forEach((r) => { byStatus[String(r.status)] = Number(r.total || 0); });

  const resultRows = await selectData(
    `SELECT ISNULL(result, 'PENDING') AS result, COUNT(1) AS total FROM dbo.inspections GROUP BY ISNULL(result, 'PENDING')`
  );
  const byResult = {};
  resultRows.forEach((r) => { byResult[String(r.result)] = Number(r.total || 0); });

  const overdueRows = await selectData(
    `
    SELECT COUNT(1) AS total
    FROM dbo.inspection_corrective_actions
    WHERE status <> 'DONE' AND due_date IS NOT NULL AND due_date < CAST(SYSUTCDATETIME() AS DATE)
    `
  );
  const openFindingRows = await selectData(
    `SELECT COUNT(1) AS total FROM dbo.inspection_findings WHERE status = 'OPEN'`
  );

  return {
    by_status: byStatus,
    by_result: byResult,
    total: Object.values(byStatus).reduce((s, n) => s + n, 0),
    overdue_actions: Number(overdueRows?.[0]?.total || 0),
    open_findings: Number(openFindingRows?.[0]?.total || 0),
  };
}

/** Per-locator compliance standing for the monitoring board. */
async function getComplianceByProponent() {
  await ensureSchema();
  return selectData(`
    SELECT
      p.id AS proponent_id,
      p.business_name AS proponent_name,
      COUNT(i.id) AS total_inspections,
      SUM(CASE WHEN i.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_inspections,
      SUM(CASE WHEN i.result = 'FAILED' THEN 1 ELSE 0 END) AS failed_inspections,
      MAX(i.conducted_date) AS last_inspection_date,
      (SELECT COUNT(1) FROM dbo.inspection_findings f
        INNER JOIN dbo.inspections ii ON ii.id = f.inspection_id
        WHERE ii.proponent_id = p.id AND f.status = 'OPEN') AS open_findings,
      (SELECT COUNT(1) FROM dbo.inspection_corrective_actions c
        INNER JOIN dbo.inspections ii ON ii.id = c.inspection_id
        WHERE ii.proponent_id = p.id AND c.status <> 'DONE') AS open_actions,
      (SELECT COUNT(1) FROM dbo.inspection_corrective_actions c
        INNER JOIN dbo.inspections ii ON ii.id = c.inspection_id
        WHERE ii.proponent_id = p.id AND c.status <> 'DONE'
          AND c.due_date IS NOT NULL AND c.due_date < CAST(SYSUTCDATETIME() AS DATE)) AS overdue_actions
    FROM dbo.proponents p
    INNER JOIN dbo.inspections i ON i.proponent_id = p.id
    GROUP BY p.id, p.business_name
    ORDER BY overdue_actions DESC, open_findings DESC, p.business_name ASC
  `);
}

async function getMeta() {
  await ensureSchema();
  const [inspectors, proponents, types] = await Promise.all([
    selectData(`
      SELECT DISTINCT u.id, u.full_name, u.username
      FROM dbo.users u
      INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
      INNER JOIN dbo.roles r ON r.id = ur.role_id
      WHERE u.is_active = 1
        AND LOWER(LTRIM(RTRIM(r.name))) IN ('admin', 'administrator', 'officer', 'account officer')
      ORDER BY u.full_name
    `),
    selectData(`SELECT id, business_name FROM dbo.proponents WHERE is_active = 1 ORDER BY business_name`),
    selectData(`SELECT id, code, name FROM dbo.inspection_types WHERE is_active = 1 ORDER BY name`),
  ]);
  return { inspectors, proponents, types };
}

async function createInspection(payload, actorId) {
  await ensureSchema();
  const proponentId = toInt(payload?.proponent_id);
  if (!proponentId) throw new Error("proponent_id is required");
  const title = String(payload?.title ?? "").trim();
  if (!title) throw new Error("title is required");

  const typeId = toInt(payload?.inspection_type_id);
  let typeCode = payload?.inspection_type_code ? String(payload.inspection_type_code).trim() : null;
  if (typeId && !typeCode) {
    const t = await selectData(`SELECT TOP (1) code FROM dbo.inspection_types WHERE id = @param0`, [typeId]);
    typeCode = t?.[0]?.code || null;
  }

  const result = await insertData(
    `
    INSERT INTO dbo.inspections
      (proponent_id, contract_id, application_id, inspection_type_id, inspection_type_code, title,
       scheduled_date, assigned_inspector_id, assigned_by, assigned_at, status, created_by, created_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7,
       CASE WHEN @param7 IS NULL THEN NULL ELSE @param8 END,
       CASE WHEN @param7 IS NULL THEN NULL ELSE SYSUTCDATETIME() END,
       'SCHEDULED', @param8, SYSUTCDATETIME())
    `,
    [
      proponentId,
      toInt(payload?.contract_id),
      toInt(payload?.application_id),
      typeId,
      typeCode,
      title.slice(0, 255),
      payload?.scheduled_date || null,
      toInt(payload?.assigned_inspector_id),
      toInt(actorId),
    ]
  );
  const id = result?.recordset?.[0]?.id;
  await logActivity(id, "SCHEDULED", `Inspection scheduled: ${title.slice(0, 150)}`, actorId);
  return getInspectionDetail(id);
}

async function updateInspection(id, payload, actorId) {
  await ensureSchema();
  const existing = await getInspectionById(id);
  if (!existing) return null;
  const sets = [];
  const params = [];
  const push = (frag, value) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (payload?.title !== undefined) {
    const t = String(payload.title ?? "").trim();
    if (!t) throw new Error("title cannot be empty");
    push("title = ?", t.slice(0, 255));
  }
  if (payload?.scheduled_date !== undefined) push("scheduled_date = ?", payload.scheduled_date || null);
  if (payload?.conducted_date !== undefined) push("conducted_date = ?", payload.conducted_date || null);
  if (payload?.contract_id !== undefined) push("contract_id = ?", toInt(payload.contract_id));
  if (payload?.application_id !== undefined) push("application_id = ?", toInt(payload.application_id));
  if (payload?.inspection_type_id !== undefined) {
    push("inspection_type_id = ?", toInt(payload.inspection_type_id));
    const t = toInt(payload.inspection_type_id)
      ? await selectData(`SELECT TOP (1) code FROM dbo.inspection_types WHERE id = @param0`, [toInt(payload.inspection_type_id)])
      : null;
    push("inspection_type_code = ?", t?.[0]?.code || null);
  }
  if (payload?.summary !== undefined) push("summary = ?", payload.summary ? String(payload.summary).slice(0, 2000) : null);
  if (!sets.length) return getInspectionDetail(id);
  push("updated_by = ?", toInt(actorId));
  const query = `UPDATE dbo.inspections SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length}`;
  params.push(toInt(id));
  await updateData(query, params);
  await logActivity(id, "UPDATED", "Inspection details updated", actorId);
  return getInspectionDetail(id);
}

async function assignInspector(id, { inspectorId, actorId }) {
  await ensureSchema();
  const existing = await getInspectionById(id);
  if (!existing) return null;
  const insId = toInt(inspectorId);
  if (!insId) throw new Error("inspectorId is required");
  await updateData(
    `
    UPDATE dbo.inspections
    SET assigned_inspector_id = @param1, assigned_by = @param2, assigned_at = SYSUTCDATETIME(),
        updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [toInt(id), insId, toInt(actorId)]
  );
  const who = await selectData(`SELECT TOP (1) full_name, username FROM dbo.users WHERE id = @param0`, [insId]);
  const name = who?.[0]?.full_name || who?.[0]?.username || `User #${insId}`;
  await logActivity(id, "ASSIGNED", `Assigned to ${name}`, actorId);
  await notifyProponentScoped({
    inspection: existing,
    actorId,
    subject: `Inspection assigned: ${existing.title}`,
    body: `${existing.inspection_type_name || "Inspection"} for ${existing.proponent_name || ""} assigned to ${name}.`,
  });
  return getInspectionDetail(id);
}

async function setStatus(id, { status, actorId }) {
  await ensureSchema();
  const existing = await getInspectionById(id);
  if (!existing) return null;
  const next = pick(status, STATUSES);
  if (!next) throw new Error("Invalid status");
  const setConducted = next === "IN_PROGRESS" && !existing.conducted_date;
  await updateData(
    `
    UPDATE dbo.inspections
    SET status = @param1,
        conducted_date = CASE WHEN @param2 = 1 THEN CAST(SYSUTCDATETIME() AS DATE) ELSE conducted_date END,
        updated_by = @param3, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [toInt(id), next, setConducted ? 1 : 0, toInt(actorId)]
  );
  await logActivity(id, "STATUS_CHANGED", `${existing.status} → ${next}`, actorId);
  return getInspectionDetail(id);
}

async function setResult(id, { result, summary, actorId }) {
  await ensureSchema();
  const existing = await getInspectionById(id);
  if (!existing) return null;
  const rs = pick(result, RESULTS);
  if (!rs) throw new Error("Invalid result");
  await updateData(
    `
    UPDATE dbo.inspections
    SET result = @param1, summary = @param2, status = 'COMPLETED',
        conducted_date = ISNULL(conducted_date, CAST(SYSUTCDATETIME() AS DATE)),
        updated_by = @param3, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [toInt(id), rs, summary ? String(summary).slice(0, 2000) : null, toInt(actorId)]
  );
  await logActivity(id, "COMPLETED", `Result: ${rs}`, actorId);
  await notifyProponentScoped({
    inspection: existing,
    actorId,
    subject: `Inspection completed: ${existing.title}`,
    body: `${existing.inspection_type_name || "Inspection"} for ${existing.proponent_name || ""} completed with result ${rs}.`,
  });
  return getInspectionDetail(id);
}

// ---- Findings ----
async function getFindingById(id) {
  const rows = await selectData(`SELECT * FROM dbo.inspection_findings WHERE id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

async function addFinding(inspectionId, payload, actorId) {
  await ensureSchema();
  const existing = await getInspectionById(inspectionId);
  if (!existing) return null;
  const description = String(payload?.description ?? "").trim();
  if (!description) throw new Error("description is required");
  const result = await insertData(
    `
    INSERT INTO dbo.inspection_findings
      (inspection_id, category, severity, description, recommendation, status, created_by, created_at)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, 'OPEN', @param5, SYSUTCDATETIME())
    `,
    [
      toInt(inspectionId),
      payload?.category ? String(payload.category).slice(0, 60) : null,
      pick(payload?.severity, FINDING_SEVERITIES),
      description.slice(0, 2000),
      payload?.recommendation ? String(payload.recommendation).slice(0, 2000) : null,
      toInt(actorId),
    ]
  );
  await logActivity(inspectionId, "FINDING_ADDED", description.slice(0, 200), actorId);
  return getFindingById(result?.recordset?.[0]?.id);
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
  if (payload?.category !== undefined) push("category = ?", payload.category ? String(payload.category).slice(0, 60) : null);
  if (payload?.severity !== undefined) push("severity = ?", pick(payload.severity, FINDING_SEVERITIES));
  if (payload?.description !== undefined) {
    const d = String(payload.description ?? "").trim();
    if (!d) throw new Error("description cannot be empty");
    push("description = ?", d.slice(0, 2000));
  }
  if (payload?.recommendation !== undefined)
    push("recommendation = ?", payload.recommendation ? String(payload.recommendation).slice(0, 2000) : null);
  if (payload?.status !== undefined) push("status = ?", pick(payload.status, FINDING_STATUSES, existing.status));
  push("updated_by = ?", toInt(actorId));
  const query = `UPDATE dbo.inspection_findings SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length}`;
  params.push(toInt(id));
  await updateData(query, params);
  await logActivity(existing.inspection_id, "FINDING_UPDATED", `Finding #${id}`, actorId);
  return getFindingById(id);
}

async function deleteFinding(id, actorId) {
  await ensureSchema();
  const existing = await getFindingById(id);
  if (!existing) return false;
  await runInTransaction(async (tx) => {
    await tx.query(`UPDATE dbo.inspection_corrective_actions SET finding_id = NULL WHERE finding_id = @param0`, [toInt(id)]);
    await tx.query(`DELETE FROM dbo.inspection_findings WHERE id = @param0`, [toInt(id)]);
  });
  await logActivity(existing.inspection_id, "FINDING_DELETED", `Finding #${id}`, actorId);
  return true;
}

// ---- Corrective actions ----
async function getActionById(id) {
  const rows = await selectData(`SELECT * FROM dbo.inspection_corrective_actions WHERE id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

async function addCorrectiveAction(inspectionId, payload, actorId) {
  await ensureSchema();
  const existing = await getInspectionById(inspectionId);
  if (!existing) return null;
  const actionRequired = String(payload?.action_required ?? "").trim();
  if (!actionRequired) throw new Error("action_required is required");
  const result = await insertData(
    `
    INSERT INTO dbo.inspection_corrective_actions
      (inspection_id, finding_id, action_required, responsible_party, due_date, status, remarks, created_by, created_at)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, SYSUTCDATETIME())
    `,
    [
      toInt(inspectionId),
      toInt(payload?.finding_id),
      actionRequired.slice(0, 2000),
      payload?.responsible_party ? String(payload.responsible_party).slice(0, 255) : null,
      payload?.due_date || null,
      pick(payload?.status, ACTION_STATUSES, "PENDING"),
      payload?.remarks ? String(payload.remarks).slice(0, 1000) : null,
      toInt(actorId),
    ]
  );
  await logActivity(inspectionId, "ACTION_ADDED", actionRequired.slice(0, 200), actorId);
  return getActionById(result?.recordset?.[0]?.id);
}

async function updateCorrectiveAction(id, payload, actorId) {
  await ensureSchema();
  const existing = await getActionById(id);
  if (!existing) return null;
  const sets = [];
  const params = [];
  const push = (frag, value) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (payload?.action_required !== undefined) {
    const a = String(payload.action_required ?? "").trim();
    if (!a) throw new Error("action_required cannot be empty");
    push("action_required = ?", a.slice(0, 2000));
  }
  if (payload?.responsible_party !== undefined)
    push("responsible_party = ?", payload.responsible_party ? String(payload.responsible_party).slice(0, 255) : null);
  if (payload?.due_date !== undefined) push("due_date = ?", payload.due_date || null);
  if (payload?.finding_id !== undefined) push("finding_id = ?", toInt(payload.finding_id));
  if (payload?.remarks !== undefined) push("remarks = ?", payload.remarks ? String(payload.remarks).slice(0, 1000) : null);
  if (payload?.status !== undefined) {
    const next = pick(payload.status, ACTION_STATUSES, existing.status);
    push("status = ?", next);
    push("completed_date = ?", next === "DONE" ? new Date().toISOString().slice(0, 10) : null);
  }
  push("updated_by = ?", toInt(actorId));
  const query = `UPDATE dbo.inspection_corrective_actions SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length}`;
  params.push(toInt(id));
  await updateData(query, params);
  await logActivity(existing.inspection_id, "ACTION_UPDATED", `Corrective action #${id}`, actorId);
  return getActionById(id);
}

async function deleteCorrectiveAction(id, actorId) {
  await ensureSchema();
  const existing = await getActionById(id);
  if (!existing) return false;
  await updateData(`DELETE FROM dbo.inspection_corrective_actions WHERE id = @param0`, [toInt(id)]);
  await logActivity(existing.inspection_id, "ACTION_DELETED", `Corrective action #${id}`, actorId);
  return true;
}

// ---- Documents (metadata only — no binary storage in this system) ----
async function addDocument(inspectionId, payload, actorId) {
  await ensureSchema();
  const existing = await getInspectionById(inspectionId);
  if (!existing) return null;
  const fileName = String(payload?.file_name ?? "").trim();
  const storagePath = String(payload?.storage_path ?? "").trim();
  if (!fileName) throw new Error("file_name is required");
  if (!storagePath) throw new Error("storage_path is required");
  const result = await insertData(
    `
    INSERT INTO dbo.inspection_documents
      (inspection_id, doc_kind, file_name, original_file_name, storage_path, content_type, file_size_bytes, created_by, created_at)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, SYSUTCDATETIME())
    `,
    [
      toInt(inspectionId),
      pick(payload?.doc_kind, DOC_KINDS, "SUPPORTING"),
      fileName.slice(0, 260),
      payload?.original_file_name ? String(payload.original_file_name).slice(0, 260) : null,
      storagePath.slice(0, 1000),
      payload?.content_type ? String(payload.content_type).slice(0, 255) : null,
      toInt(payload?.file_size_bytes),
      toInt(actorId),
    ]
  );
  await logActivity(inspectionId, "DOCUMENT_ADDED", fileName.slice(0, 200), actorId);
  const rows = await selectData(`SELECT * FROM dbo.inspection_documents WHERE id = @param0`, [result?.recordset?.[0]?.id]);
  return rows?.[0] || null;
}

async function deleteDocument(id, actorId) {
  await ensureSchema();
  const rows = await selectData(`SELECT * FROM dbo.inspection_documents WHERE id = @param0`, [toInt(id)]);
  const existing = rows?.[0];
  if (!existing) return false;
  await updateData(`DELETE FROM dbo.inspection_documents WHERE id = @param0`, [toInt(id)]);
  await logActivity(existing.inspection_id, "DOCUMENT_DELETED", existing.file_name, actorId);
  return true;
}

module.exports = {
  ensureSchema,
  STATUSES,
  RESULTS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  ACTION_STATUSES,
  DOC_KINDS,
  listInspections,
  getInspectionById,
  getInspectionDetail,
  getComplianceSummary,
  getComplianceByProponent,
  getMeta,
  createInspection,
  updateInspection,
  assignInspector,
  setStatus,
  setResult,
  addFinding,
  updateFinding,
  deleteFinding,
  addCorrectiveAction,
  updateCorrectiveAction,
  deleteCorrectiveAction,
  addDocument,
  deleteDocument,
};
