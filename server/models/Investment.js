/**
 * dbo.proponent_investment — a locator's Investment / No. Employee commitment vs.
 * actual figures (legacy BRIDGE dbLocator InvestmentCommit/InvestmentActual/
 * EmployeeCommit/EmployeeActual columns).
 *
 * One row per (proponent, metric_type) — never more (UX_proponent_investment_proponent_metric)
 * — created only once a metric actually has something in it. A future third metric needs
 * a new row, not two new columns, same reasoning as FinancialTerms.js.
 *
 * Soft-deletable (is_active) with the same created_by/at + updated_by/at audit trail as
 * every other table in this app.
 */
const { selectData, updateSchema } = require("../config/database");
const Proponent = require("./Proponent");

// prefix used in the flat API shape (investment_commitment, ...) -> stored metric_type
const METRIC_TYPES = {
  investment: "INVESTMENT",
  employee: "EMPLOYEE_COUNT",
};

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
    IF OBJECT_ID('dbo.proponent_investment', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponent_investment (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        metric_type NVARCHAR(30) NOT NULL,
        commitment NVARCHAR(50) NULL,
        actual NVARCHAR(50) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_investment_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_proponent_investment_is_active DEFAULT (1),
        CONSTRAINT FK_proponent_investment_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE,
        CONSTRAINT UX_proponent_investment_proponent_metric UNIQUE (proponent_id, metric_type)
      );

      -- No separate proponent_id index: the unique constraint above leads with it.
    END
  `);
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Returns the flat { investment_commitment, investment_actual, employee_commitment,
 * employee_actual } shape the controller/frontend form use — callers don't need to know
 * this lives in a child table. */
async function getForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT metric_type, commitment, actual FROM dbo.proponent_investment WHERE proponent_id = @param0 AND is_active = 1`,
    [proponentId]
  );
  const byType = new Map(rows.map((r) => [r.metric_type, r]));
  const result = {};
  for (const [prefix, type] of Object.entries(METRIC_TYPES)) {
    const row = byType.get(type);
    result[`${prefix}_commitment`] = row?.commitment ?? null;
    result[`${prefix}_actual`] = row?.actual ?? null;
  }
  return result;
}

/** Applies whichever of the four flat fields are present in `fields` (create sends all
 * four; update only sends the ones actually changing). A metric's row is only touched
 * when at least one of its two fields is present, and is only created once one of them
 * is. Runs inside the caller's transaction, alongside the rest of the locator save. */
async function upsertForProponent(tx, proponentId, fields, actorId) {
  const actor = toInt(actorId);
  for (const [prefix, type] of Object.entries(METRIC_TYPES)) {
    const commitmentKey = `${prefix}_commitment`;
    const actualKey = `${prefix}_actual`;
    const touched = [commitmentKey, actualKey].some((k) => fields[k] !== undefined);
    if (!touched) continue;

    const existing = await tx.query(
      `SELECT id FROM dbo.proponent_investment WHERE proponent_id = @param0 AND metric_type = @param1`,
      [proponentId, type]
    );
    const id = existing.recordset?.[0]?.id;

    if (id) {
      const params = [id];
      const sets = [];
      const pushSet = (col, value) => {
        sets.push(`${col} = @param${params.length}`);
        params.push(value);
      };
      if (fields[commitmentKey] !== undefined) pushSet("commitment", fields[commitmentKey] ?? null);
      if (fields[actualKey] !== undefined) pushSet("actual", fields[actualKey] ?? null);
      pushSet("updated_by", actor);
      await tx.query(
        `UPDATE dbo.proponent_investment SET ${sets.join(", ")}, updated_at = GETDATE() WHERE id = @param0`,
        params
      );
    } else {
      await tx.query(
        `INSERT INTO dbo.proponent_investment (proponent_id, metric_type, commitment, actual, created_by)
         VALUES (@param0, @param1, @param2, @param3, @param4)`,
        [proponentId, type, fields[commitmentKey] ?? null, fields[actualKey] ?? null, actor]
      );
    }
  }
}

module.exports = { ensureSchema, getForProponent, upsertForProponent };
