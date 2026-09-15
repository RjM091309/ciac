const { selectData, insertData, updateData, updateSchema, runInTransaction } = require("../config/database");
const Notification = require("./Notification");
const Permit = require("./Permit");
const { sendMail } = require("../lib/mailer");

function toInt(v) {
  // Number(null) is 0, not NaN — without this guard, an explicitly-absent
  // optional FK (document_id, when no document is picked) silently became 0
  // instead of NULL and violated the FK constraint against dbo.documents.
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getLocatorContactByApplicationId(applicationId) {
  const rows = await selectData(
    `
    SELECT TOP (1) u.email, u.full_name, a.application_no
    FROM dbo.applications a
    JOIN dbo.proponents p ON p.id = a.proponent_id
    JOIN dbo.users u ON u.id = p.user_id
    WHERE a.id = @param0 AND u.email IS NOT NULL AND u.email <> ''
    `,
    [toInt(applicationId)]
  );
  return rows?.[0] || null;
}

async function ensureSchema() {
  await updateSchema(`
    -- Shared with application-number generation (ApplicationWorkflow.js) — a
    -- plain counter_key/last_value table, reused here for contract numbers so
    -- there's one generic sequence mechanism instead of two.
    IF OBJECT_ID('dbo.application_no_counters', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_no_counters (
        counter_key NVARCHAR(50) NOT NULL PRIMARY KEY,
        last_value INT NOT NULL CONSTRAINT DF_app_no_counters_last_value_contracts DEFAULT (0)
      );
    END;

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
  const normalizedContractNo = String(contractNo || "").trim();
  try {
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

  // Only email on the initial signing, not every later edit (e.g. attaching
  // the scanned file afterward) — this is the "your business is now under
  // contract" moment the locator actually needs pinged about.
  if (isUpdate) return;
  try {
    const locator = await getLocatorContactByApplicationId(applicationId);
    if (locator?.email) {
      const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
      await sendMail({
        to: locator.email,
        subject: `Contract signed: ${locator.application_no || "your application"}`,
        text:
          `Hello ${locator.full_name || ""},\n\n` +
          `Your business application ${locator.application_no || ""} now has a signed contract` +
          `${normalizedContractNo ? ` (${normalizedContractNo})` : ""} on record.\n\n` +
          `Sign in to the portal for details: ${loginUrl}\n`,
        html:
          `<p>Hello ${locator.full_name || ""},</p>` +
          `<p>Your business application <b>${locator.application_no || ""}</b> now has a signed contract` +
          `${normalizedContractNo ? ` (<b>${normalizedContractNo}</b>)` : ""} on record.</p>` +
          `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
      });
    }
  } catch (error) {
    console.error("Send contract-signed email error:", error);
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

/** Server-authoritative reference number: CTR-{APPLICATION_TYPE}-YYYY-00001,
 * incrementing per type+year — mirrors generateApplicationNo in
 * ApplicationWorkflow.js, sharing its counter table. Generated inside the
 * same transaction as the contract insert so concurrent saves never race
 * onto the same number. */
function contractCounterKey(applicationType) {
  const typeCode = String(applicationType || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "GEN";
  const year = new Date().getFullYear();
  return `CTR-${typeCode}-${year}`;
}

async function generateContractNo(tx, applicationType) {
  const counterKey = contractCounterKey(applicationType);

  const result = await tx.query(
    `
    MERGE dbo.application_no_counters WITH (HOLDLOCK) AS target
    USING (SELECT @param0 AS counter_key) AS src
    ON target.counter_key = src.counter_key
    WHEN MATCHED THEN UPDATE SET last_value = target.last_value + 1
    WHEN NOT MATCHED THEN INSERT (counter_key, last_value) VALUES (src.counter_key, 1)
    OUTPUT INSERTED.last_value;
    `,
    [counterKey]
  );
  const seq = result?.recordset?.[0]?.last_value || 1;
  return `${counterKey}-${String(seq).padStart(5, "0")}`;
}

/** Read-only look at what generateContractNo would hand out next, without
 * reserving it — for showing the locator/officer the number before they
 * actually save (the real save still runs generateContractNo transactionally,
 * so this preview can't cause a collision, only be off if another contract
 * of the same type+year is saved in between). */
async function previewContractNo(applicationType) {
  await ensureSchema();
  const counterKey = contractCounterKey(applicationType);
  const rows = await selectData(
    `SELECT last_value FROM dbo.application_no_counters WHERE counter_key = @param0`,
    [counterKey]
  );
  const nextSeq = Number(rows?.[0]?.last_value || 0) + 1;
  return `${counterKey}-${String(nextSeq).padStart(5, "0")}`;
}

// Keeps a "CONTRACT"-type row in the Compliance/Permits module in step with
// this contract, using the contract's actual validity window — effective
// start/end, not the issue_date audit timestamp — so the Permits page's own
// EXPIRING/EXPIRED logic (reads expiry_date) tracks when the lease itself
// lapses. One permit row per application, created on first save and
// refreshed on every later edit rather than duplicated.
async function syncContractPermit({ applicationId, contractNo, effectiveStart, effectiveEnd, documentId, actorId }) {
  try {
    const appRows = await selectData(
      `SELECT proponent_id FROM dbo.applications WHERE id = @param0`,
      [toInt(applicationId)]
    );
    const proponentId = toInt(appRows?.[0]?.proponent_id);
    if (!proponentId) return;

    const existingRows = await selectData(
      `SELECT id FROM dbo.permits WHERE application_id = @param0 AND permit_type = 'CONTRACT'`,
      [toInt(applicationId)]
    );
    const existing = existingRows?.[0];

    const payload = {
      permit_type: "CONTRACT",
      permit_no: contractNo,
      issuing_authority: "CIAC",
      issue_date: effectiveStart,
      expiry_date: effectiveEnd,
      document_id: documentId,
      remarks: `Auto-synced from Contract ${contractNo}`,
    };

    if (existing) {
      await Permit.update(existing.id, { ...payload, is_active: true, updated_by: actorId });
    } else {
      await Permit.create({
        ...payload,
        proponent_id: proponentId,
        application_id: applicationId,
        created_by: actorId,
      });
    }
  } catch (error) {
    console.error("Sync contract permit error:", error);
  }
}

async function createContract({
  application_id,
  application_type,
  effective_start,
  effective_end,
  document_id,
  created_by,
}) {
  await ensureSchema();
  await Notification.ensureSchema();

  const id = await runInTransaction(async (tx) => {
    const contractNo = await generateContractNo(tx, application_type);
    const result = await tx.query(
      `
      INSERT INTO dbo.contracts
        (application_id, contract_no, issue_date, effective_start, effective_end, document_id, created_by, updated_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@param0, @param1, SYSUTCDATETIME(), @param2, @param3, @param4, @param5, NULL, SYSUTCDATETIME(), NULL)
      `,
      [
        toInt(application_id),
        contractNo,
        effective_start || null,
        effective_end || null,
        toInt(document_id),
        toInt(created_by),
      ]
    );
    return result?.recordset?.[0]?.id;
  });

  if (!id) return null;
  const saved = await getById(id);
  await syncContractPermit({
    applicationId: application_id,
    contractNo: saved?.contract_no,
    effectiveStart: saved?.effective_start,
    effectiveEnd: saved?.effective_end,
    documentId: saved?.document_id,
    actorId: created_by,
  });
  await createContractNotifications({
    applicationId: application_id,
    contractNo: saved?.contract_no,
    actorId: created_by,
    isUpdate: false,
  });
  return saved;
}

// contract_no and issue_date are the audit trail of when/what this contract
// was first issued as — only effective dates and the executed file can
// change afterward, never the number or the issue timestamp.
async function updateContract(id, { effective_start, effective_end, document_id, updated_by }) {
  await ensureSchema();
  await Notification.ensureSchema();
  await updateData(
    `
    UPDATE dbo.contracts
    SET
      effective_start = @param1,
      effective_end = @param2,
      document_id = @param3,
      updated_by = @param4,
      updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [toInt(id), effective_start || null, effective_end || null, toInt(document_id), toInt(updated_by)]
  );

  const current = await getById(id);
  await syncContractPermit({
    applicationId: current?.application_id,
    contractNo: current?.contract_no,
    effectiveStart: current?.effective_start,
    effectiveEnd: current?.effective_end,
    documentId: current?.document_id,
    actorId: updated_by,
  });
  await createContractNotifications({
    applicationId: current?.application_id,
    contractNo: current?.contract_no,
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
  previewContractNo,
};

