/**
 * dbo.proponent_leases — a locator's lease agreements (A-02 / A-03 / A-04).
 *
 * One row per lease: the first contract (or the encoded lease of a locator
 * registered by hand) and one more for every approved renewal. Exactly one
 * active row per locator is is_current = 1.
 *
 * The current lease's Ref. Code, Date Signed and encoded Start/End stay on
 * dbo.proponents too (ref_code, date_signed, manual_start_term/_end_term) —
 * search, the Registered Locator list, reports and the LEASE permit read them
 * there — and are mirrored onto the current row on every save
 * (syncCurrentFromProponent). Earlier leases keep the values they had: that's
 * the lease history. A lease linked to a contract takes its Start/End from the
 * contract (an approved contract's dates always win).
 *
 * The property schedule belongs to a lease (proponent_properties.lease_id,
 * A-03): editing touches the current lease's rows only, and a renewal starts
 * with a copy of the previous lease's schedule.
 *
 * Ref. Codes are never reused (see Proponent.assertUniqueField).
 */
const { selectData, updateSchema } = require("../config/database");

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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
  // dbo.proponents / dbo.contracts / dbo.proponent_properties already exist —
  // Proponent.ensureSchema runs first (see Proponent.ensureChildTables).
  await updateSchema(`
    IF OBJECT_ID('dbo.proponent_leases', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponent_leases (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        ref_code NVARCHAR(50) NULL,
        contract_id INT NULL,
        application_id INT NULL,
        contract_type_id INT NULL,
        date_signed DATE NULL,
        start_term DATE NULL,
        end_term DATE NULL,
        is_current BIT NOT NULL CONSTRAINT DF_proponent_leases_is_current DEFAULT (0),
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_leases_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_proponent_leases_is_active DEFAULT (1),
        CONSTRAINT FK_proponent_leases_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE
      );
      CREATE INDEX IX_proponent_leases_proponent ON dbo.proponent_leases(proponent_id, is_current);
    END
  `);
  // The lease a property-schedule row belongs to (NULL on rows saved before
  // leases existed — the backfill below assigns them to the current lease).
  await updateSchema(`
    IF COL_LENGTH('dbo.proponent_properties', 'lease_id') IS NULL
      ALTER TABLE dbo.proponent_properties ADD lease_id INT NULL;
  `);
  await backfill();
}

/** One-time, per locator: a locator with no lease rows gets them — one per
 * approved contract (oldest first) or, with none, one for its encoded lease —
 * the latest being current, carrying the locator's Ref. Code and Date Signed;
 * its property rows are assigned to the current lease. Locators that already
 * have leases are never touched, so this only ever runs once each. Additive:
 * nothing is changed or removed. */
async function backfill() {
  await updateSchema(`
    IF OBJECT_ID('tempdb..#lease_todo') IS NOT NULL DROP TABLE #lease_todo;
    SELECT p.id AS proponent_id
    INTO #lease_todo
    FROM dbo.proponents p
    WHERE NOT EXISTS (SELECT 1 FROM dbo.proponent_leases l WHERE l.proponent_id = p.id);

    IF EXISTS (SELECT 1 FROM #lease_todo)
    BEGIN
      -- One lease per approved contract (only once applications exist at all).
      IF OBJECT_ID('dbo.applications', 'U') IS NOT NULL AND OBJECT_ID('dbo.contracts', 'U') IS NOT NULL
      INSERT INTO dbo.proponent_leases (proponent_id, contract_id, application_id, contract_type_id, start_term, end_term, is_current)
      SELECT a.proponent_id, c.id, a.id, COALESCE(c.contract_type_id, a.contract_type_id),
             CAST(c.effective_start AS DATE), CAST(c.effective_end AS DATE), 0
      FROM dbo.contracts c
      JOIN dbo.applications a ON a.id = c.application_id
      JOIN #lease_todo t ON t.proponent_id = a.proponent_id
      WHERE a.status = 'APPROVED';

      -- No approved contract: the encoded lease (manual registration / legacy).
      INSERT INTO dbo.proponent_leases (proponent_id, contract_type_id, start_term, end_term, is_current)
      SELECT p.id, p.contract_type_id, p.manual_start_term, p.manual_end_term, 0
      FROM dbo.proponents p
      JOIN #lease_todo t ON t.proponent_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM dbo.proponent_leases l WHERE l.proponent_id = p.id);

      -- The latest one is current and carries the locator's Ref. Code / Date Signed.
      ;WITH ranked AS (
        SELECT l.id, l.proponent_id,
               ROW_NUMBER() OVER (PARTITION BY l.proponent_id ORDER BY ISNULL(l.end_term, '9999-12-31') DESC, l.id DESC) AS rn
        FROM dbo.proponent_leases l
        JOIN #lease_todo t ON t.proponent_id = l.proponent_id
      )
      UPDATE l SET l.is_current = 1, l.ref_code = NULLIF(LTRIM(RTRIM(p.ref_code)), ''), l.date_signed = p.date_signed
      FROM dbo.proponent_leases l
      JOIN ranked r ON r.id = l.id AND r.rn = 1
      JOIN dbo.proponents p ON p.id = l.proponent_id;

      -- Existing property rows belong to the current lease.
      UPDATE pp SET pp.lease_id = l.id
      FROM dbo.proponent_properties pp
      JOIN dbo.proponent_leases l ON l.proponent_id = pp.proponent_id AND l.is_current = 1
      JOIN #lease_todo t ON t.proponent_id = pp.proponent_id
      WHERE pp.lease_id IS NULL;
    END

    DROP TABLE #lease_todo;
  `);
}

/** The current lease's id, creating one from the locator's own fields when it
 * has none yet (e.g. a locator inserted outside the app since the last start).
 * `tx`: run inside the caller's transaction. */
async function currentLeaseId(proponentId, tx = null) {
  // Inside a transaction the caller has already ensured the schema (DDL stays out of it).
  if (!tx) await ensureSchema();
  const pid = toInt(proponentId);
  const run = (sql, params) => (tx ? tx.query(sql, params).then((r) => r.recordset || []) : selectData(sql, params));
  const rows = await run(
    `SELECT TOP (1) id FROM dbo.proponent_leases WHERE proponent_id = @param0 AND is_current = 1 AND is_active = 1 ORDER BY id DESC`,
    [pid]
  );
  if (rows[0]?.id) return rows[0].id;
  const created = await run(
    `INSERT INTO dbo.proponent_leases (proponent_id, ref_code, contract_type_id, date_signed, start_term, end_term, is_current)
     OUTPUT INSERTED.id
     SELECT p.id, NULLIF(LTRIM(RTRIM(p.ref_code)), ''), p.contract_type_id, p.date_signed, p.manual_start_term, p.manual_end_term, 1
     FROM dbo.proponents p WHERE p.id = @param0`,
    [pid]
  );
  const id = created[0]?.id ?? null;
  if (id) {
    await run(`UPDATE dbo.proponent_properties SET lease_id = @param1 WHERE proponent_id = @param0 AND lease_id IS NULL`, [pid, id]);
  }
  return id;
}

/** Mirrors the locator's current-lease fields onto its current lease row. */
async function syncCurrentFromProponent(tx, proponentId, actorId = null) {
  const leaseId = await currentLeaseId(proponentId, tx);
  if (!leaseId) return;
  await tx.query(
    `UPDATE l SET
       l.ref_code = NULLIF(LTRIM(RTRIM(p.ref_code)), ''),
       l.date_signed = p.date_signed,
       l.start_term = CASE WHEN l.contract_id IS NULL THEN p.manual_start_term ELSE l.start_term END,
       l.end_term = CASE WHEN l.contract_id IS NULL THEN p.manual_end_term ELSE l.end_term END,
       l.contract_type_id = CASE WHEN l.contract_id IS NULL THEN p.contract_type_id ELSE l.contract_type_id END,
       l.updated_by = @param2, l.updated_at = GETDATE()
     FROM dbo.proponent_leases l JOIN dbo.proponents p ON p.id = l.proponent_id
     WHERE l.id = @param0 AND p.id = @param1`,
    [leaseId, toInt(proponentId), toInt(actorId)]
  );
}

/**
 * An application was approved (ApprovalIssuance). Records its contract as a lease:
 *  - a new application whose locator's current lease has no contract yet → that
 *    lease gets the contract (the first contract of a filed locator);
 *  - otherwise (a renewal, or a lease that already had a contract) → a NEW
 *    current lease with the contract; the previous one becomes history. The new
 *    lease starts with a copy of the previous lease's property schedule, and the
 *    locator's Ref. Code / Date Signed are cleared — a renewal gets its own Ref.
 *    Code (A-04), typed in by the Account Officer.
 * Idempotent: a contract already recorded on a lease is left alone.
 */
async function recordApprovedApplication(applicationId, actorId = null) {
  await ensureSchema();
  const app = (
    await selectData(
      `SELECT TOP (1) a.id, a.proponent_id, a.is_renewal, a.contract_type_id,
              c.id AS contract_id, c.contract_type_id AS c_type, c.effective_start, c.effective_end
       FROM dbo.applications a
       LEFT JOIN dbo.contracts c ON c.application_id = a.id
       WHERE a.id = @param0
       ORDER BY c.id DESC`,
      [toInt(applicationId)]
    )
  )[0];
  if (!app?.proponent_id || !app.contract_id) return;
  const already = await selectData(`SELECT 1 AS x FROM dbo.proponent_leases WHERE contract_id = @param0`, [app.contract_id]);
  if (already.length) return;

  const { runInTransaction } = require("../config/database");
  await runInTransaction(async (tx) => {
    const pid = toInt(app.proponent_id);
    const curId = await currentLeaseId(pid, tx);
    const cur = curId
      ? (await tx.query(`SELECT id, contract_id FROM dbo.proponent_leases WHERE id = @param0`, [curId])).recordset?.[0]
      : null;
    const typeId = app.c_type ?? app.contract_type_id ?? null;
    const start = app.effective_start || null;
    const end = app.effective_end || null;

    if (cur && !cur.contract_id && !Number(app.is_renewal)) {
      await tx.query(
        `UPDATE dbo.proponent_leases
         SET contract_id = @param1, application_id = @param2, contract_type_id = COALESCE(@param3, contract_type_id),
             start_term = CAST(@param4 AS DATE), end_term = CAST(@param5 AS DATE), updated_by = @param6, updated_at = GETDATE()
         WHERE id = @param0`,
        [cur.id, app.contract_id, app.id, typeId, start, end, toInt(actorId)]
      );
      return;
    }

    if (curId) {
      await tx.query(`UPDATE dbo.proponent_leases SET is_current = 0, updated_by = @param1, updated_at = GETDATE() WHERE id = @param0`, [
        curId,
        toInt(actorId),
      ]);
    }
    const inserted = await tx.query(
      `INSERT INTO dbo.proponent_leases (proponent_id, contract_id, application_id, contract_type_id, start_term, end_term, is_current, created_by)
       OUTPUT INSERTED.id
       VALUES (@param0, @param1, @param2, @param3, CAST(@param4 AS DATE), CAST(@param5 AS DATE), 1, @param6)`,
      [pid, app.contract_id, app.id, typeId, start, end, toInt(actorId)]
    );
    const newId = inserted.recordset?.[0]?.id;
    if (curId && newId) {
      // The renewal starts from the previous lease's schedule (editable from here).
      await tx.query(
        `INSERT INTO dbo.proponent_properties
           (proponent_id, lease_id, sort_order, year, date_from, date_to, type_of_property, area_sqm, rate_sqm_mo,
            rate_currency, mgl_mo, mgl_currency, rate_type, created_by)
         SELECT proponent_id, @param1, sort_order, year, date_from, date_to, type_of_property, area_sqm, rate_sqm_mo,
                rate_currency, mgl_mo, mgl_currency, rate_type, @param2
         FROM dbo.proponent_properties
         WHERE lease_id = @param0 AND is_active = 1`,
        [curId, newId, toInt(actorId)]
      );
    }
    // The renewal's own Ref. Code / Date Signed are typed in by the Account Officer.
    await tx.query(`UPDATE dbo.proponents SET ref_code = NULL, date_signed = NULL, updated_at = GETDATE() WHERE id = @param0`, [pid]);
  });
}

/** Every lease of a locator, newest first, with its dates (the contract's when
 * linked), type, and — for earlier leases — their property schedule. */
async function listForProponent(proponentId) {
  await ensureSchema();
  const pid = toInt(proponentId);
  await currentLeaseId(pid);
  const leases = await selectData(
    `SELECT l.id, l.ref_code, l.is_current, l.contract_id, l.application_id, l.date_signed,
            CAST(COALESCE(c.effective_start, l.start_term) AS DATE) AS start_term,
            CAST(COALESCE(c.effective_end, l.end_term) AS DATE) AS end_term,
            c.contract_no, a.application_no, a.is_renewal, toc.name AS contract_type_name
     FROM dbo.proponent_leases l
     LEFT JOIN dbo.contracts c ON c.id = l.contract_id
     LEFT JOIN dbo.applications a ON a.id = l.application_id
     LEFT JOIN dbo.type_of_contract toc ON toc.id = COALESCE(l.contract_type_id, c.contract_type_id, a.contract_type_id)
     WHERE l.proponent_id = @param0 AND l.is_active = 1
     ORDER BY l.is_current DESC, ISNULL(COALESCE(c.effective_end, l.end_term), '9999-12-31') DESC, l.id DESC`,
    [pid]
  );
  const ids = leases.filter((l) => !l.is_current).map((l) => l.id);
  let props = [];
  if (ids.length) {
    props = await selectData(
      `SELECT id, lease_id, year, date_from, date_to, type_of_property, area_sqm, rate_sqm_mo, rate_currency, mgl_mo, mgl_currency, rate_type
       FROM dbo.proponent_properties
       WHERE proponent_id = @param0 AND is_active = 1 AND lease_id IN (${ids.map((_, i) => `@param${i + 1}`).join(", ")})
       ORDER BY sort_order ASC, id ASC`,
      [pid, ...ids]
    );
  }
  const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
  return leases.map((l) => ({
    id: l.id,
    ref_code: l.ref_code ?? null,
    is_current: Boolean(l.is_current),
    contract_id: l.contract_id ?? null,
    contract_no: l.contract_no ?? null,
    application_no: l.application_no ?? null,
    is_renewal: Boolean(l.is_renewal),
    contract_type_name: l.contract_type_name ?? null,
    date_signed: ymd(l.date_signed),
    start_term: ymd(l.start_term),
    end_term: ymd(l.end_term),
    properties: l.is_current ? undefined : props.filter((p) => p.lease_id === l.id),
  }));
}

module.exports = { ensureSchema, currentLeaseId, syncCurrentFromProponent, recordApprovedApplication, listForProponent };
