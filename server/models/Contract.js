const { selectData, insertData, updateData, updateSchema } = require("../config/database");
const Notification = require("./Notification");

function toInt(v) {
  // Number(null) is 0, not NaN — without this guard, an explicitly-absent
  // optional FK (document_id, when no document is picked) silently became 0
  // instead of NULL and violated the FK constraint against dbo.documents.
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.contracts', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.contracts (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        contract_no NVARCHAR(100) NOT NULL,
        issue_date DATETIME2(3) NOT NULL,
        effective_start DATETIME2(3) NULL,
        effective_end DATETIME2(3) NULL,
        document_id INT NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_contracts_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );

      CREATE INDEX IX_contracts_application_id ON dbo.contracts(application_id);
    END
    ELSE
    BEGIN
      IF COL_LENGTH('dbo.contracts', 'created_by') IS NULL
        ALTER TABLE dbo.contracts ADD created_by INT NULL;

      IF COL_LENGTH('dbo.contracts', 'updated_by') IS NULL
        ALTER TABLE dbo.contracts ADD updated_by INT NULL;

      IF COL_LENGTH('dbo.contracts', 'created_at') IS NULL
        ALTER TABLE dbo.contracts ADD created_at DATETIME2(3) NOT NULL CONSTRAINT DF_contracts_created_at DEFAULT (SYSUTCDATETIME());

      IF COL_LENGTH('dbo.contracts', 'updated_at') IS NULL
        ALTER TABLE dbo.contracts ADD updated_at DATETIME2(3) NULL;

      IF COL_LENGTH('dbo.contracts', 'certificate_path') IS NULL
        ALTER TABLE dbo.contracts ADD certificate_path NVARCHAR(1000) NULL;
    END;
  `);
}

async function setCertificatePath(id, certificatePath) {
  await ensureSchema();
  await updateData(`UPDATE dbo.contracts SET certificate_path = @param1 WHERE id = @param0`, [
    toInt(id),
    certificatePath || null,
  ]);
}

async function getCertificatePath(id) {
  await ensureSchema();
  const rows = await selectData(`SELECT certificate_path FROM dbo.contracts WHERE id = @param0`, [toInt(id)]);
  return rows?.[0]?.certificate_path || null;
}

async function createContractNotifications({ applicationId, contractNo, actorId, isUpdate }) {
  try {
    const normalizedContractNo = String(contractNo || "").trim();
    await Notification.createApplicationScopedNotifications({
      applicationId,
      actorId,
      eventType: "contract",
      subject: `Contract ${isUpdate ? "updated" : "created"}`,
      body: `Contract ${normalizedContractNo || "record"} was ${isUpdate ? "updated" : "created"} for this application.`,
    });
  } catch (error) {
    console.error("Create contract notifications error:", error);
  }
}

function withHasCertificate(row) {
  if (!row) return row;
  const { certificate_path, ...rest } = row;
  return { ...rest, has_certificate: Boolean(certificate_path) };
}

async function getById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      c.id,
      c.application_id,
      c.contract_no,
      c.issue_date,
      c.effective_start,
      c.effective_end,
      c.document_id,
      c.created_by,
      c.updated_by,
      c.created_at,
      c.updated_at,
      c.certificate_path
    FROM dbo.contracts c
    WHERE c.id = @param0
    `,
    [id]
  );
  return withHasCertificate(rows?.[0]) || null;
}

async function getByApplicationId(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      c.id,
      c.application_id,
      c.contract_no,
      c.issue_date,
      c.effective_start,
      c.effective_end,
      c.document_id,
      c.created_by,
      c.updated_by,
      c.created_at,
      c.updated_at,
      c.certificate_path
    FROM dbo.contracts c
    WHERE c.application_id = @param0
    ORDER BY c.id DESC
    `,
    [applicationId]
  );
  return withHasCertificate(rows?.[0]) || null;
}

// System-wide, for the Account Officer's "Needs Your Attention" widget
// (expiring/expired contracts) — everything else here is scoped to one
// proponent or application.
async function listAll() {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      c.id,
      c.application_id,
      c.contract_no,
      c.issue_date,
      c.effective_start,
      c.effective_end,
      c.document_id,
      c.created_at,
      c.updated_at,
      a.application_no,
      a.is_renewal,
      p.business_name AS proponent_name
    FROM dbo.contracts c
    INNER JOIN dbo.applications a ON a.id = c.application_id
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    ORDER BY c.id DESC
    `
  );
  return rows;
}

async function listByProponentId(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      c.id,
      c.application_id,
      c.contract_no,
      c.issue_date,
      c.effective_start,
      c.effective_end,
      c.document_id,
      c.created_at,
      c.updated_at,
      c.certificate_path,
      a.application_no,
      a.is_renewal
    FROM dbo.contracts c
    INNER JOIN dbo.applications a ON a.id = c.application_id
    WHERE a.proponent_id = @param0
    ORDER BY c.id DESC
    `,
    [toInt(proponentId)]
  );
  return rows.map(withHasCertificate);
}

async function createContract({
  application_id,
  contract_no,
  issue_date,
  effective_start,
  effective_end,
  document_id,
  created_by,
}) {
  await ensureSchema();
  await Notification.ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.contracts
      (application_id, contract_no, issue_date, effective_start, effective_end, document_id, created_by, updated_by, created_at, updated_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, NULL, SYSUTCDATETIME(), NULL)
    `,
    [
      toInt(application_id),
      String(contract_no || "").trim(),
      issue_date || null,
      effective_start || null,
      effective_end || null,
      toInt(document_id),
      toInt(created_by),
    ]
  );

  const id = result?.recordset?.[0]?.id;
  if (!id) return null;
  await createContractNotifications({
    applicationId: application_id,
    contractNo: contract_no,
    actorId: created_by,
    isUpdate: false,
  });
  return getById(id);
}

async function updateContract(
  id,
  { contract_no, issue_date, effective_start, effective_end, document_id, updated_by }
) {
  await ensureSchema();
  await Notification.ensureSchema();
  await updateData(
    `
    UPDATE dbo.contracts
    SET
      contract_no = @param1,
      issue_date = @param2,
      effective_start = @param3,
      effective_end = @param4,
      document_id = @param5,
      updated_by = @param6,
      updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [
      toInt(id),
      String(contract_no || "").trim(),
      issue_date || null,
      effective_start || null,
      effective_end || null,
      toInt(document_id),
      toInt(updated_by),
    ]
  );

  const current = await getById(id);
  await createContractNotifications({
    applicationId: current?.application_id,
    contractNo: contract_no,
    actorId: updated_by,
    isUpdate: true,
  });

  return current;
}

module.exports = {
  ensureSchema,
  getById,
  getByApplicationId,
  listAll,
  listByProponentId,
  createContract,
  updateContract,
  setCertificatePath,
  getCertificatePath,
};

