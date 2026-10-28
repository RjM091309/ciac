// Where a new proponent starts: their letter (hard copy) reaches BDO Level 1,
// who records the business name, scans in the letter and picks the BDO
// Level 2 who'll handle it. That Level 2 is emailed, opens it on Proponent
// Accounts ("Start application") and files the account and application from
// there; the application is then theirs to evaluate without a separate
// assignment step. OPEN until filed (FILED, with its application — listed
// until that's submitted, if saved as a draft) or cancelled by Level 1
// (CANCELLED).
const fs = require("fs");
const path = require("path");
const { selectData, insertData, updateData, updateSchema } = require("../config/database");
const { STORAGE_ROOT, resolveStoredPath, relativeStoragePath } = require("../lib/fileStorage");

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.proponent_intakes', 'U') IS NULL
      CREATE TABLE dbo.proponent_intakes (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        business_name NVARCHAR(255) NOT NULL,
        assigned_to INT NOT NULL,
        letter_path NVARCHAR(500) NULL,
        letter_name NVARCHAR(255) NULL,
        status VARCHAR(12) NOT NULL CONSTRAINT DF_proponent_intakes_status DEFAULT ('OPEN'),
        application_id INT NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_intakes_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        CONSTRAINT FK_proponent_intakes_assigned_to FOREIGN KEY (assigned_to) REFERENCES dbo.users(id),
        CONSTRAINT FK_proponent_intakes_application FOREIGN KEY (application_id) REFERENCES dbo.applications(id) ON DELETE SET NULL
      );
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const SELECT = `
  SELECT i.id, i.business_name, i.assigned_to, i.letter_name, i.status, i.application_id,
         i.created_by, i.created_at, i.updated_at,
         CASE WHEN i.letter_path IS NULL THEN 0 ELSE 1 END AS has_letter,
         COALESCE(NULLIF(u.full_name, ''), u.username) AS assigned_name,
         COALESCE(NULLIF(c.full_name, ''), c.username) AS created_by_name,
         a.application_no, a.status AS application_status
  FROM dbo.proponent_intakes i
  LEFT JOIN dbo.users u ON u.id = i.assigned_to
  LEFT JOIN dbo.users c ON c.id = i.created_by
  LEFT JOIN dbo.applications a ON a.id = i.application_id
`;

/** Still with the BDO: not filed yet, or filed as a draft (gone once
 * submitted). Level 1 sees all; a Level 2 only theirs. */
async function list({ assignedTo = null } = {}) {
  await ensureSchema();
  const uid = toInt(assignedTo);
  return selectData(
    `${SELECT} WHERE (i.status = 'OPEN' OR (i.status = 'FILED' AND a.status = 'DRAFT'))
     ${uid ? "AND i.assigned_to = @param0" : ""} ORDER BY i.created_at DESC`,
    uid ? [uid] : []
  );
}

async function getById(id) {
  await ensureSchema();
  const rows = await selectData(`${SELECT} WHERE i.id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

/** The intake an application was filed from, if any. */
async function getByApplicationId(applicationId) {
  await ensureSchema();
  const rows = await selectData(`${SELECT} WHERE i.application_id = @param0`, [toInt(applicationId)]);
  return rows?.[0] || null;
}

/** Moves the uploaded letter out of incoming/ into intakes/. */
function storeLetter(absPath) {
  const dir = path.join(STORAGE_ROOT, "intakes");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(absPath));
  try {
    fs.renameSync(absPath, target);
    return relativeStoragePath(target);
  } catch {
    return relativeStoragePath(absPath);
  }
}

async function create({ businessName, assignedTo, letterAbsPath, letterName, actorId }) {
  await ensureSchema();
  const letterPath = letterAbsPath ? storeLetter(letterAbsPath) : null;
  let result;
  try {
    result = await insertData(
      `
      INSERT INTO dbo.proponent_intakes (business_name, assigned_to, letter_path, letter_name, created_by)
      OUTPUT inserted.id
      VALUES (@param0, @param1, @param2, @param3, @param4)
      `,
      [String(businessName).trim().slice(0, 255), toInt(assignedTo), letterPath, letterName ? String(letterName).slice(0, 255) : null, toInt(actorId)]
    );
  } catch (error) {
    // Not saved: don't leave the letter behind.
    const abs = resolveStoredPath(letterPath);
    if (abs) fs.rm(abs, { force: true }, () => {});
    throw error;
  }
  return getById(result?.recordset?.[0]?.id);
}

async function reassign(id, assignedTo) {
  await ensureSchema();
  await updateData(
    `UPDATE dbo.proponent_intakes SET assigned_to = @param1, updated_at = SYSUTCDATETIME() WHERE id = @param0 AND status = 'OPEN'`,
    [toInt(id), toInt(assignedTo)]
  );
  return getById(id);
}

async function cancel(id) {
  await ensureSchema();
  await updateData(
    `UPDATE dbo.proponent_intakes SET status = 'CANCELLED', updated_at = SYSUTCDATETIME() WHERE id = @param0 AND status = 'OPEN'`,
    [toInt(id)]
  );
  return getById(id);
}

/** Takes it for filing (OPEN → FILED) before the account and application
 * are made, so it can't be filed twice. False when it was no longer open. */
async function claim(id) {
  await ensureSchema();
  const result = await updateData(
    `UPDATE dbo.proponent_intakes SET status = 'FILED', updated_at = SYSUTCDATETIME()
     OUTPUT inserted.id
     WHERE id = @param0 AND status = 'OPEN'`,
    [toInt(id)]
  );
  return Boolean(result?.recordset?.length);
}

/** Links the claimed intake to the application it became. */
async function attachApplication(id, applicationId) {
  await ensureSchema();
  await updateData(`UPDATE dbo.proponent_intakes SET application_id = @param1, updated_at = SYSUTCDATETIME() WHERE id = @param0`, [
    toInt(id),
    toInt(applicationId),
  ]);
}

/** Back to OPEN: filing failed, or its draft application was deleted. */
async function reopen(id) {
  await ensureSchema();
  await updateData(
    `UPDATE dbo.proponent_intakes SET status = 'OPEN', application_id = NULL, updated_at = SYSUTCDATETIME() WHERE id = @param0 AND status = 'FILED'`,
    [toInt(id)]
  );
}

/** Absolute path and file name of the letter, or null. */
async function letterFile(id) {
  await ensureSchema();
  const rows = await selectData(`SELECT letter_path, letter_name FROM dbo.proponent_intakes WHERE id = @param0`, [toInt(id)]);
  const abs = resolveStoredPath(rows?.[0]?.letter_path);
  if (!abs || !fs.existsSync(abs)) return null;
  return { path: abs, name: rows[0].letter_name || "Letter.pdf" };
}

module.exports = { ensureSchema, list, getById, getByApplicationId, create, reassign, cancel, claim, attachApplication, reopen, letterFile };
