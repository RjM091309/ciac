/**
 * dbo.proponent_extensions — a locator's lease extensions, one row each
 * (Extensions card on the Locator Information panel).
 *
 * Each row is tied to the lease that was current when it was added. The
 * latest active row is mirrored onto dbo.proponents.extension_date /
 * extension_remarks, which reports (LocatorReport) and older screens read.
 *
 * A locator whose extension was typed in before this table existed has its
 * value only on dbo.proponents: it's listed as a row (id null) and saved
 * into this table the first time an extension is added or removed — never
 * on startup.
 */
const { selectData, updateSchema, runInTransaction } = require("../config/database");

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let ensurePromise = null;

/** Memoised per process; a failure clears the memo so the next call retries. */
function ensureSchema() {
  if (!ensurePromise) {
    ensurePromise = updateSchema(`
      IF OBJECT_ID('dbo.proponent_extensions', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.proponent_extensions (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          proponent_id INT NOT NULL,
          lease_id INT NULL,
          extension_date DATE NULL,
          remarks NVARCHAR(300) NULL,
          created_by INT NULL,
          created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_extensions_created_at DEFAULT (SYSUTCDATETIME()),
          updated_by INT NULL,
          updated_at DATETIME2(3) NULL,
          is_active BIT NOT NULL CONSTRAINT DF_proponent_extensions_is_active DEFAULT (1),
          CONSTRAINT FK_proponent_extensions_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE
        );
        CREATE INDEX IX_proponent_extensions_proponent ON dbo.proponent_extensions(proponent_id, is_active);
      END
    `).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

async function activeCount(run, pid) {
  const rows = await run(`SELECT COUNT(1) AS n FROM dbo.proponent_extensions WHERE proponent_id = @param0 AND is_active = 1`, [pid]);
  return Number(rows[0]?.n || 0);
}

/** Every extension of a locator, newest first. */
async function listForProponent(proponentId) {
  await ensureSchema();
  const pid = toInt(proponentId);
  const rows = await selectData(
    `SELECT e.id, e.extension_date, e.remarks, e.created_at, l.ref_code AS lease_ref_code,
            COALESCE(NULLIF(u.full_name, ''), u.username) AS encoded_by
     FROM dbo.proponent_extensions e
     LEFT JOIN dbo.proponent_leases l ON l.id = e.lease_id
     LEFT JOIN dbo.users u ON u.id = e.created_by
     WHERE e.proponent_id = @param0 AND e.is_active = 1
     ORDER BY ISNULL(e.extension_date, '1900-01-01') DESC, e.id DESC`,
    [pid]
  );
  const list = rows.map((r) => ({
    id: r.id,
    extension_date: ymd(r.extension_date),
    remarks: r.remarks ?? null,
    lease_ref_code: r.lease_ref_code ?? null,
    encoded_by: r.encoded_by ?? null,
    created_at: r.created_at ?? null,
  }));
  if (list.length) return list;
  // Typed in before this table existed: only on dbo.proponents.
  const legacy = (
    await selectData(`SELECT extension_date, extension_remarks FROM dbo.proponents WHERE id = @param0`, [pid])
  )[0];
  if (legacy && (legacy.extension_date || String(legacy.extension_remarks || "").trim())) {
    return [
      {
        id: null,
        extension_date: ymd(legacy.extension_date),
        remarks: legacy.extension_remarks ?? null,
        lease_ref_code: null,
        encoded_by: null,
        created_at: null,
      },
    ];
  }
  return [];
}

/** Saves the locator's pre-table extension as a row, once (inside `tx`). */
async function keepLegacy(tx, pid, actorId) {
  const run = (sql, params) => tx.query(sql, params).then((r) => r.recordset || []);
  if (await activeCount(run, pid)) return;
  const anyRow = await run(`SELECT TOP (1) 1 AS x FROM dbo.proponent_extensions WHERE proponent_id = @param0`, [pid]);
  if (anyRow.length) return; // every row was removed on purpose — don't bring the old one back
  await tx.query(
    `INSERT INTO dbo.proponent_extensions (proponent_id, lease_id, extension_date, remarks, created_by)
     SELECT p.id,
            (SELECT TOP (1) l.id FROM dbo.proponent_leases l WHERE l.proponent_id = p.id AND l.is_current = 1 AND l.is_active = 1 ORDER BY l.id DESC),
            p.extension_date, NULLIF(LTRIM(RTRIM(p.extension_remarks)), ''), @param1
     FROM dbo.proponents p
     WHERE p.id = @param0 AND (p.extension_date IS NOT NULL OR NULLIF(LTRIM(RTRIM(p.extension_remarks)), '') IS NOT NULL)`,
    [pid, toInt(actorId)]
  );
}

/** dbo.proponents.extension_date / _remarks = the latest active extension (or none). */
async function syncLatest(tx, pid) {
  await tx.query(
    `UPDATE p SET p.extension_date = x.extension_date, p.extension_remarks = x.remarks, p.updated_at = GETDATE()
     FROM dbo.proponents p
     OUTER APPLY (
       SELECT TOP (1) e.extension_date, e.remarks
       FROM dbo.proponent_extensions e
       WHERE e.proponent_id = p.id AND e.is_active = 1
       ORDER BY ISNULL(e.extension_date, '1900-01-01') DESC, e.id DESC
     ) x
     WHERE p.id = @param0`,
    [pid]
  );
}

/** Adds an extension under the locator's current lease. */
async function add(proponentId, { extension_date, remarks }, actorId = null) {
  await ensureSchema();
  const pid = toInt(proponentId);
  const leaseId = await require("./ProponentLease").currentLeaseId(pid);
  await runInTransaction(async (tx) => {
    await keepLegacy(tx, pid, actorId);
    await tx.query(
      `INSERT INTO dbo.proponent_extensions (proponent_id, lease_id, extension_date, remarks, created_by)
       VALUES (@param0, @param1, CAST(@param2 AS DATE), @param3, @param4)`,
      [pid, leaseId, extension_date || null, remarks || null, toInt(actorId)]
    );
    await syncLatest(tx, pid);
  });
  return listForProponent(pid);
}

/** Removes one extension (soft delete). `extensionId` null = the pre-table one. */
async function remove(proponentId, extensionId, actorId = null) {
  await ensureSchema();
  const pid = toInt(proponentId);
  await runInTransaction(async (tx) => {
    if (extensionId == null) {
      await keepLegacy(tx, pid, actorId);
      await tx.query(
        `UPDATE dbo.proponent_extensions SET is_active = 0, updated_by = @param1, updated_at = GETDATE()
         WHERE proponent_id = @param0 AND is_active = 1`,
        [pid, toInt(actorId)]
      );
    } else {
      await tx.query(
        `UPDATE dbo.proponent_extensions SET is_active = 0, updated_by = @param2, updated_at = GETDATE()
         WHERE id = @param1 AND proponent_id = @param0`,
        [pid, toInt(extensionId), toInt(actorId)]
      );
    }
    await syncLatest(tx, pid);
  });
  return listForProponent(pid);
}

module.exports = { ensureSchema, listForProponent, add, remove };
