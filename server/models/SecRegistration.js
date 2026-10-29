/**
 * dbo.proponent_sec_registration — the rest of a locator's SEC registration
 * details, shown on the Stockholders tab's "SEC Registration Information" card
 * (modelled on the SEC forms: Company Information, Contact Person Information,
 * primary / secondary purpose, and the latest GIS filing).
 *
 * The SEC fields that already lived on dbo.proponents (registration_no, tin,
 * sec_registration_date, ref_code, address, the three capital amounts) stay
 * there — other screens and the locator portal read them — and are edited on
 * the same card.
 *
 * One row per proponent (UX_proponent_sec_registration_proponent), created the
 * first time any of these fields has something in it. The SEC contact person
 * here is separate from the locator's own Contact Person list
 * (dbo.contact_person): it is whoever the SEC registration names.
 */
const { selectData, updateSchema } = require("../config/database");
const Proponent = require("./Proponent");

// flat API key (as the form sends it) -> column
const FIELDS = {
  sec_company_email: "company_email",
  sec_company_telephone: "company_telephone",
  sec_company_mobile: "company_mobile",
  sec_primary_purpose: "primary_purpose",
  sec_secondary_purpose: "secondary_purpose",
  sec_gis_date: "gis_date",
  sec_contact_name: "contact_name",
  sec_contact_email: "contact_email",
  sec_contact_telephone: "contact_telephone",
  sec_contact_mobile: "contact_mobile",
};
const DATE_FIELDS = new Set(["sec_gis_date"]);

let ensurePromise = null;

/** Memoised per process; a failure clears the memo so the next call retries. */
function ensureSchema() {
  if (!ensurePromise) {
    ensurePromise = createSchema().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

async function createSchema() {
  await Proponent.ensureSchema(); // the FK below needs dbo.proponents to exist first
  await updateSchema(`
    IF OBJECT_ID('dbo.proponent_sec_registration', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponent_sec_registration (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        company_email NVARCHAR(255) NULL,
        company_telephone NVARCHAR(100) NULL,
        company_mobile NVARCHAR(100) NULL,
        primary_purpose NVARCHAR(MAX) NULL,
        secondary_purpose NVARCHAR(MAX) NULL,
        gis_date DATE NULL,
        contact_name NVARCHAR(150) NULL,
        contact_email NVARCHAR(255) NULL,
        contact_telephone NVARCHAR(100) NULL,
        contact_mobile NVARCHAR(100) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_sec_registration_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_proponent_sec_registration_is_active DEFAULT (1),
        CONSTRAINT FK_proponent_sec_registration_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE,
        CONSTRAINT UX_proponent_sec_registration_proponent UNIQUE (proponent_id)
      );
    END
  `);
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Blank -> null; dates as YYYY-MM-DD. */
function cleanValue(key, value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return DATE_FIELDS.has(key) ? text.slice(0, 10) : text;
}

/** Only the sec_* keys a request actually sent (undefined = leave as is). */
function pickFields(body) {
  const out = {};
  for (const key of Object.keys(FIELDS)) {
    if (body && body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

/** Flat { sec_company_email, ... } shape, every key present (null when unset). */
async function getForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT ${Object.values(FIELDS).join(", ")} FROM dbo.proponent_sec_registration WHERE proponent_id = @param0 AND is_active = 1`,
    [proponentId]
  );
  const row = rows?.[0] || {};
  const result = {};
  for (const [key, column] of Object.entries(FIELDS)) {
    const value = row[column] ?? null;
    result[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  return result;
}

/** Applies whichever sec_* keys are present in `fields`; creates the row the
 * first time one of them has a value. Runs inside the caller's transaction. */
async function upsertForProponent(tx, proponentId, fields, actorId) {
  const present = Object.keys(FIELDS).filter((k) => fields && fields[k] !== undefined);
  if (!present.length) return;
  const actor = toInt(actorId);

  const existing = await tx.query(`SELECT id FROM dbo.proponent_sec_registration WHERE proponent_id = @param0`, [proponentId]);
  const id = existing.recordset?.[0]?.id;

  if (id) {
    const params = [id];
    const sets = present.map((key) => {
      params.push(cleanValue(key, fields[key]));
      return `${FIELDS[key]} = @param${params.length - 1}`;
    });
    params.push(actor);
    await tx.query(
      `UPDATE dbo.proponent_sec_registration SET ${sets.join(", ")}, updated_by = @param${params.length - 1}, updated_at = GETDATE(), is_active = 1 WHERE id = @param0`,
      params
    );
    return;
  }

  if (!present.some((key) => cleanValue(key, fields[key]) !== null)) return; // nothing to store yet
  const columns = present.map((key) => FIELDS[key]);
  const params = [proponentId, ...present.map((key) => cleanValue(key, fields[key])), actor];
  await tx.query(
    `INSERT INTO dbo.proponent_sec_registration (proponent_id, ${columns.join(", ")}, created_by)
     VALUES (${params.map((_, i) => `@param${i}`).join(", ")})`,
    params
  );
}

module.exports = { ensureSchema, getForProponent, upsertForProponent, pickFields, FIELDS };
