/**
 * dbo.contact_person — a locator's contact people (legacy BRIDGE dbContactPerson).
 *
 * Child table of dbo.proponents, edited from the locator form (the "Contact Person" tab) and
 * synced by id on every locator save: rows are updated or inserted, and rows removed in
 * the form are deactivated, not deleted. The table itself is created on boot (see app.js).
 */
const { selectData, updateSchema } = require("../config/database");
const Proponent = require("./Proponent");

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
  // The FK below needs dbo.proponents to exist first.
  await Proponent.ensureSchema();
  await updateSchema(`
    IF OBJECT_ID('dbo.contact_person', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.contact_person (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        name NVARCHAR(100) NOT NULL,
        designation NVARCHAR(100) NULL,
        contact_no NVARCHAR(50) NULL,
        email NVARCHAR(255) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_contact_person_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_contact_person_is_active DEFAULT (1),
        CONSTRAINT FK_contact_person_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
      );

      CREATE INDEX IX_contact_person_proponent ON dbo.contact_person(proponent_id);
    END
  `);
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null; // Number(null) is 0, which is not "no user"
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const clean = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

/** A locator's active contact people, oldest first. */
async function listForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT id, name, designation, contact_no, email
    FROM dbo.contact_person
    WHERE proponent_id = @param0 AND is_active = 1
    ORDER BY id ASC
    `,
    [proponentId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    designation: r.designation ?? null,
    contact_no: r.contact_no ?? null,
    email: r.email ?? null,
  }));
}

/** Syncs a locator's contact people to the submitted list, inside the caller's transaction:
 * rows carrying an id are updated, rows without one are inserted, and active rows that
 * are no longer submitted are deactivated (never deleted, so their audit trail stays).
 * No-op when `rows` is undefined, so a caller that doesn't touch this list can't wipe it. */
async function syncForProponent(tx, proponentId, rows, actorId) {
  if (rows === undefined) return;
  const incoming = (Array.isArray(rows) ? rows : []).filter((r) => String(r?.name || "").trim());
  const actor = toInt(actorId);

  const existing = await tx.query(`SELECT id FROM dbo.contact_person WHERE proponent_id = @param0 AND is_active = 1`, [proponentId]);
  const keep = new Set();

  for (const row of incoming) {
    const params = [String(row.name).trim(), clean(row.designation), clean(row.contact_no), clean(row.email), actor];
    const id = toInt(row.id);
    const owned = id && (existing.recordset || []).some((e) => e.id === id);
    if (owned) {
      keep.add(id);
      await tx.query(
        `UPDATE dbo.contact_person
         SET name = @param1, designation = @param2, contact_no = @param3, email = @param4,
             updated_by = @param5, updated_at = GETDATE()
         WHERE id = @param0`,
        [id, ...params]
      );
    } else {
      await tx.query(
        `INSERT INTO dbo.contact_person (proponent_id, name, designation, contact_no, email, created_by)
         VALUES (@param0, @param1, @param2, @param3, @param4, @param5)`,
        [proponentId, ...params]
      );
    }
  }

  for (const e of existing.recordset || []) {
    if (!keep.has(e.id)) {
      await tx.query(`UPDATE dbo.contact_person SET is_active = 0, updated_by = @param1, updated_at = GETDATE() WHERE id = @param0`, [e.id, actor]);
    }
  }
}

module.exports = { ensureSchema, listForProponent, syncForProponent };
