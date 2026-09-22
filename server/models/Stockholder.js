/**
 * dbo.stockholder — a locator's stockholders (legacy BRIDGE dbStockHolder).
 *
 * Child table of dbo.proponents, edited from the locator form (the "Stockholders Information" tab) and
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
    IF OBJECT_ID('dbo.stockholder', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.stockholder (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        name NVARCHAR(200) NOT NULL,
        nationality NVARCHAR(100) NULL,
        subscribed DECIMAL(19,4) NOT NULL CONSTRAINT DF_stockholder_subscribed DEFAULT (0),
        paid DECIMAL(19,4) NOT NULL CONSTRAINT DF_stockholder_paid DEFAULT (0),
        ownership DECIMAL(19,4) NOT NULL CONSTRAINT DF_stockholder_ownership DEFAULT (0),
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_stockholder_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_stockholder_is_active DEFAULT (1),
        CONSTRAINT FK_stockholder_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
      );

      CREATE INDEX IX_stockholder_proponent ON dbo.stockholder(proponent_id);
    END
  `);
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null; // Number(null) is 0, which is not "no user"
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "", null, "1,234.50" -> number. Anything that isn't a number is a caller error, not a 0. */
function toDecimal(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  return n;
}

/** A locator's active stockholders, oldest first. */
async function listForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT id, name, nationality, subscribed, paid, ownership
    FROM dbo.stockholder
    WHERE proponent_id = @param0 AND is_active = 1
    ORDER BY id ASC
    `,
    [proponentId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nationality: r.nationality ?? null,
    subscribed: r.subscribed,
    paid: r.paid,
    ownership: r.ownership,
  }));
}

/** Syncs a locator's stockholders to the submitted list, inside the caller's transaction:
 * rows carrying an id are updated, rows without one are inserted, and active rows that
 * are no longer submitted are deactivated (never deleted, so their audit trail stays).
 * No-op when `rows` is undefined, so a caller that doesn't touch this list can't wipe it. */
async function syncForProponent(tx, proponentId, rows, actorId) {
  if (rows === undefined) return;
  const incoming = (Array.isArray(rows) ? rows : []).filter((r) => String(r?.name || "").trim());
  const actor = toInt(actorId);

  const existing = await tx.query(`SELECT id FROM dbo.stockholder WHERE proponent_id = @param0 AND is_active = 1`, [proponentId]);
  const keep = new Set();

  for (const row of incoming) {
    const params = [
      String(row.name).trim(),
      row.nationality ? String(row.nationality).trim() : null,
      toDecimal(row.subscribed, "Subscribed"),
      toDecimal(row.paid, "Paid"),
      toDecimal(row.ownership, "Ownership"),
      actor,
    ];
    const id = toInt(row.id);
    const owned = id && (existing.recordset || []).some((e) => e.id === id);
    if (owned) {
      keep.add(id);
      await tx.query(
        `UPDATE dbo.stockholder
         SET name = @param1, nationality = @param2, subscribed = @param3, paid = @param4, ownership = @param5,
             updated_by = @param6, updated_at = GETDATE()
         WHERE id = @param0`,
        [id, ...params]
      );
    } else {
      await tx.query(
        `INSERT INTO dbo.stockholder (proponent_id, name, nationality, subscribed, paid, ownership, created_by)
         VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6)`,
        [proponentId, ...params]
      );
    }
  }

  for (const e of existing.recordset || []) {
    if (!keep.has(e.id)) {
      await tx.query(`UPDATE dbo.stockholder SET is_active = 0, updated_by = @param1, updated_at = GETDATE() WHERE id = @param0`, [e.id, actor]);
    }
  }
}

module.exports = { ensureSchema, listForProponent, syncForProponent };
