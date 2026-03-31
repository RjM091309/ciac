const { selectData, insertData, updateData, updateSchema } = require("../config/database");
const Notification = require("./Notification");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBit(v) {
  return Number(v) ? 1 : 0;
}

async function createStatusChangeNotifications({ application, toStatus, remarks, changedBy }) {
  try {
    const subject = `Application ${String(application?.application_no || "").trim()} status updated`;
    const bodyBase = `Status changed from ${String(application?.status || "UNKNOWN").trim()} to ${String(toStatus || "").trim()}.`;
    const body = remarks ? `${bodyBase} Remarks: ${String(remarks).trim()}` : bodyBase;
    await Notification.createApplicationScopedNotifications({
      applicationId: application?.id,
      actorId: changedBy,
      eventType: "application_status",
      subject,
      body,
    });
  } catch (error) {
    console.error("Create status-change notifications error:", error);
  }
}

async function createApplicationCreatedNotifications({ applicationId, applicationNo, isRenewal, status, createdBy }) {
  try {
    const entryLabel = Number(isRenewal) ? "Renewal" : "New application";
    const appNo = String(applicationNo || "").trim();
    const currentStatus = String(status || "SUBMITTED").trim();
    await Notification.createApplicationScopedNotifications({
      applicationId,
      actorId: createdBy,
      eventType: "application_status",
      subject: `${entryLabel} ${appNo} created`,
      body: `${entryLabel} ${appNo} was created with initial status ${currentStatus}.`,
    });
  } catch (error) {
    console.error("Create application notifications error:", error);
  }
}

async function createRequirementStatusNotifications({
  application,
  requirementCode,
  requirementName,
  nextStatus,
  remarks,
  actorId,
}) {
  try {
    const requirementLabel = [String(requirementCode || "").trim(), String(requirementName || "").trim()]
      .filter(Boolean)
      .join(" - ");
    const subject = `Requirement updated for ${String(application?.application_no || "").trim()}`;
    const bodyBase = `${requirementLabel || "Requirement"} changed to ${String(nextStatus || "").trim()}.`;
    const body = remarks ? `${bodyBase} Remarks: ${String(remarks).trim()}` : bodyBase;
    await Notification.createApplicationScopedNotifications({
      applicationId: application?.id,
      actorId,
      eventType: "requirement",
      subject,
      body,
    });
  } catch (error) {
    console.error("Create requirement notifications error:", error);
  }
}

async function createDocumentNotifications({
  application,
  requirementCode,
  requirementName,
  fileName,
  originalFileName,
  actorId,
}) {
  try {
    const requirementLabel = [String(requirementCode || "").trim(), String(requirementName || "").trim()]
      .filter(Boolean)
      .join(" - ");
    const documentLabel = String(originalFileName || fileName || "Document").trim();
    const bodySuffix = requirementLabel ? ` for ${requirementLabel}` : "";
    await Notification.createApplicationScopedNotifications({
      applicationId: application?.id,
      actorId,
      eventType: "document",
      subject: `Document uploaded for ${String(application?.application_no || "").trim()}`,
      body: `${documentLabel} was uploaded${bodySuffix}.`,
    });
  } catch (error) {
    console.error("Create document notifications error:", error);
  }
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.applications', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.applications (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        application_no NVARCHAR(100) NOT NULL,
        application_type NVARCHAR(50) NOT NULL,
        is_renewal BIT NOT NULL CONSTRAINT DF_applications_is_renewal DEFAULT (0),
        status NVARCHAR(50) NOT NULL,
        submitted_at DATETIME2(3) NULL,
        current_officer_id INT NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_applications_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_applications_proponent_id ON dbo.applications(proponent_id);
      CREATE INDEX IX_applications_status ON dbo.applications(status);
      CREATE INDEX IX_applications_application_no ON dbo.applications(application_no);
    END;

    IF OBJECT_ID('dbo.application_requirements', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_requirements (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        requirement_id INT NOT NULL,
        status NVARCHAR(50) NOT NULL CONSTRAINT DF_app_req_status DEFAULT ('PENDING'),
        remarks NVARCHAR(1000) NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_req_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_app_req_application_id ON dbo.application_requirements(application_id);
      CREATE INDEX IX_app_req_requirement_id ON dbo.application_requirements(requirement_id);
      CREATE UNIQUE INDEX UX_app_req_app_req ON dbo.application_requirements(application_id, requirement_id);
    END;

    IF OBJECT_ID('dbo.documents', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.documents (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        requirement_id INT NULL,
        file_name NVARCHAR(260) NOT NULL,
        original_file_name NVARCHAR(260) NULL,
        storage_path NVARCHAR(1000) NOT NULL,
        content_type NVARCHAR(255) NULL,
        file_size_bytes BIGINT NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_documents_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_documents_application_id ON dbo.documents(application_id);
      CREATE INDEX IX_documents_requirement_id ON dbo.documents(requirement_id);
    END;

    IF OBJECT_ID('dbo.application_status_history', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_status_history (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        from_status NVARCHAR(50) NULL,
        to_status NVARCHAR(50) NOT NULL,
        changed_by INT NOT NULL,
        remarks NVARCHAR(1000) NULL,
        changed_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_status_changed_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_app_status_history_app_id ON dbo.application_status_history(application_id);
      CREATE INDEX IX_app_status_history_to_status ON dbo.application_status_history(to_status);
    END;
  `);
}

async function listApplications() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_by,
      a.updated_by,
      a.created_at,
      a.updated_at,
      (
        SELECT COUNT(1)
        FROM dbo.application_requirements ar
        WHERE ar.application_id = a.id
      ) AS requirements_count
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    ORDER BY a.id DESC
  `);
  return rows;
}

async function getApplicationById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_by,
      a.updated_by,
      a.created_at,
      a.updated_at
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    WHERE a.id = @param0
    `,
    [id]
  );
  return rows?.[0] || null;
}

async function createApplication({
  proponent_id,
  application_no,
  application_type,
  is_renewal,
  status = "SUBMITTED",
  submitted_at,
  current_officer_id,
  created_by,
}) {
  await ensureSchema();
  await Notification.ensureSchema();
  const proponentId = toInt(proponent_id);
  const officerId = toInt(current_officer_id);
  const createdBy = toInt(created_by);

  const result = await insertData(
    `
    INSERT INTO dbo.applications
      (proponent_id, application_no, application_type, is_renewal, status, submitted_at, current_officer_id, created_by, updated_by, created_at, updated_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, NULL, SYSUTCDATETIME(), NULL)
    `,
    [
      proponentId,
      String(application_no || "").trim(),
      String(application_type || "").trim(),
      toBit(is_renewal),
      String(status || "SUBMITTED").trim(),
      submitted_at || null,
      officerId,
      createdBy,
    ]
  );

  const id = result?.recordset?.[0]?.id;
  if (!id) return null;

  await insertData(
    `
    INSERT INTO dbo.application_requirements
      (application_id, requirement_id, status, remarks, created_by, updated_by, created_at, updated_at)
    SELECT
      @param0,
      r.id,
      'PENDING',
      NULL,
      @param1,
      NULL,
      SYSUTCDATETIME(),
      NULL
    FROM dbo.requirements r
    WHERE r.is_active = 1
      AND (
        (@param2 = 1 AND r.for_renewal = 1)
        OR
        (@param2 = 0 AND r.for_new = 1)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.application_requirements ar
        WHERE ar.application_id = @param0 AND ar.requirement_id = r.id
      )
    `,
    [id, createdBy, toBit(is_renewal)]
  );

  await insertData(
    `
    INSERT INTO dbo.application_status_history
      (application_id, from_status, to_status, changed_by, remarks, changed_at)
    VALUES
      (@param0, NULL, @param1, @param2, @param3, SYSUTCDATETIME())
    `,
    [id, String(status || "SUBMITTED").trim(), createdBy, "Initial status on create"]
  );

  await createApplicationCreatedNotifications({
    applicationId: id,
    applicationNo: application_no,
    isRenewal: is_renewal,
    status,
    createdBy,
  });

  return getApplicationById(id);
}

async function updateApplicationStatus(id, { to_status, remarks, changed_by }) {
  await ensureSchema();
  await Notification.ensureSchema();
  const application = await getApplicationById(id);
  if (!application) return null;

  const toStatus = String(to_status || "").trim();
  if (!toStatus) {
    throw new Error("to_status is required");
  }

  const changedBy = toInt(changed_by);

  await updateData(
    `
    UPDATE dbo.applications
    SET status = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [id, toStatus, changedBy]
  );

  await insertData(
    `
    INSERT INTO dbo.application_status_history
      (application_id, from_status, to_status, changed_by, remarks, changed_at)
    VALUES
      (@param0, @param1, @param2, @param3, @param4, SYSUTCDATETIME())
    `,
    [id, application.status || null, toStatus, changedBy, remarks ?? null]
  );

  await createStatusChangeNotifications({
    application,
    toStatus,
    remarks,
    changedBy,
  });

  return getApplicationById(id);
}

async function listApplicationRequirements(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      ar.id,
      ar.application_id,
      ar.requirement_id,
      ar.status,
      ar.remarks,
      ar.created_by,
      ar.updated_by,
      ar.created_at,
      ar.updated_at,
      r.code AS requirement_code,
      r.name AS requirement_name,
      r.description AS requirement_description,
      r.is_mandatory
    FROM dbo.application_requirements ar
    INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
    WHERE ar.application_id = @param0
    ORDER BY ar.id ASC
    `,
    [applicationId]
  );
  return rows;
}

async function updateApplicationRequirementStatus(id, { status, remarks, updated_by }) {
  await ensureSchema();
  await Notification.ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      ar.id,
      ar.application_id,
      ar.requirement_id,
      r.code AS requirement_code,
      r.name AS requirement_name
    FROM dbo.application_requirements ar
    LEFT JOIN dbo.requirements r ON r.id = ar.requirement_id
    WHERE ar.id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  if (!row) return null;

  await updateData(
    `
    UPDATE dbo.application_requirements
    SET
      status = @param1,
      remarks = @param2,
      updated_by = @param3,
      updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [id, String(status || "PENDING").trim(), remarks ?? null, toInt(updated_by)]
  );

  const updatedRows = await selectData(
    `
    SELECT TOP (1)
      ar.id,
      ar.application_id,
      ar.requirement_id,
      ar.status,
      ar.remarks,
      ar.created_by,
      ar.updated_by,
      ar.created_at,
      ar.updated_at
    FROM dbo.application_requirements ar
    WHERE ar.id = @param0
    `,
    [id]
  );
  const updated = updatedRows?.[0] || null;
  if (updated) {
    const application = await getApplicationById(row.application_id);
    await createRequirementStatusNotifications({
      application,
      requirementCode: row.requirement_code,
      requirementName: row.requirement_name,
      nextStatus: status,
      remarks,
      actorId: updated_by,
    });
  }
  return updated;
}

async function listDocumentsByApplication(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      d.id,
      d.application_id,
      d.requirement_id,
      d.file_name,
      d.original_file_name,
      d.storage_path,
      d.content_type,
      d.file_size_bytes,
      d.created_by,
      d.updated_by,
      d.created_at,
      d.updated_at,
      r.code AS requirement_code,
      r.name AS requirement_name
    FROM dbo.documents d
    LEFT JOIN dbo.requirements r ON r.id = d.requirement_id
    WHERE d.application_id = @param0
    ORDER BY d.id DESC
    `,
    [applicationId]
  );
  return rows;
}

async function createDocument({
  application_id,
  requirement_id,
  file_name,
  original_file_name,
  storage_path,
  content_type,
  file_size_bytes,
  created_by,
}) {
  await ensureSchema();
  await Notification.ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.documents
      (application_id, requirement_id, file_name, original_file_name, storage_path, content_type, file_size_bytes, created_by, updated_by, created_at, updated_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, NULL, SYSUTCDATETIME(), NULL)
    `,
    [
      toInt(application_id),
      toInt(requirement_id),
      String(file_name || "").trim(),
      original_file_name ?? null,
      String(storage_path || "").trim(),
      content_type ?? null,
      toInt(file_size_bytes),
      toInt(created_by),
    ]
  );
  const id = result?.recordset?.[0]?.id;
  const rows = await selectData(
    `
    SELECT TOP (1)
      d.*,
      r.code AS requirement_code,
      r.name AS requirement_name
    FROM dbo.documents d
    LEFT JOIN dbo.requirements r ON r.id = d.requirement_id
    WHERE d.id = @param0
    `,
    [id]
  );
  const document = rows?.[0] || null;
  if (document) {
    const application = await getApplicationById(application_id);
    await createDocumentNotifications({
      application,
      requirementCode: document.requirement_code,
      requirementName: document.requirement_name,
      fileName: document.file_name,
      originalFileName: document.original_file_name,
      actorId: created_by,
    });
  }
  return document;
}

async function listApplicationStatusHistory(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      h.id,
      h.application_id,
      h.from_status,
      h.to_status,
      h.changed_by,
      h.remarks,
      h.changed_at
    FROM dbo.application_status_history h
    WHERE h.application_id = @param0
    ORDER BY h.id DESC
    `,
    [applicationId]
  );
  return rows;
}

module.exports = {
  ensureSchema,
  listApplications,
  getApplicationById,
  createApplication,
  updateApplicationStatus,
  listApplicationRequirements,
  updateApplicationRequirementStatus,
  listDocumentsByApplication,
  createDocument,
  listApplicationStatusHistory,
};
