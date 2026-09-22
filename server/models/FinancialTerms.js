/**
 * dbo.proponent_financial_terms — a locator's Advance Lease Payment / Security Deposit /
 * Performance Security terms (legacy BRIDGE dbLocator ALP.../SD.../PS... columns).
 *
 * One row per (proponent, term_type) — never more (UX_proponent_financial_terms_proponent_type)
 * — created only once a category actually has something in it. Replaces the nine
 * advance_lease_payment_/security_deposit_/performance_security_-prefixed columns that
 * used to live directly on dbo.proponents, so a future fourth category needs a new row,
 * not three new columns.
 *
 * Soft-deletable (is_active) with the same created_by/at + updated_by/at audit trail as
 * every other table in this app. Nothing in the UI clears a category today — the locator
 * form's three fixed sections only ever set values on it — so is_active stays 1 in
 * practice, but the column is there for when something needs to remove one deliberately.
 */
const { selectData, updateSchema } = require("../config/database");
const Proponent = require("./Proponent");

// prefix used in the flat API shape (advance_lease_payment_months, ...) -> stored term_type
const TERM_TYPES = {
  advance_lease_payment: "ADVANCE_LEASE_PAYMENT",
  security_deposit: "SECURITY_DEPOSIT",
  performance_security: "PERFORMANCE_SECURITY",
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
    IF OBJECT_ID('dbo.proponent_financial_terms', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponent_financial_terms (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        term_type NVARCHAR(30) NOT NULL,
        months NVARCHAR(255) NULL,
        amount NVARCHAR(50) NULL,
        currency NVARCHAR(10) NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_financial_terms_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_proponent_financial_terms_is_active DEFAULT (1),
        CONSTRAINT FK_proponent_financial_terms_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE,
        CONSTRAINT UX_proponent_financial_terms_proponent_type UNIQUE (proponent_id, term_type)
      );

      CREATE INDEX IX_proponent_financial_terms_proponent ON dbo.proponent_financial_terms(proponent_id);
    END
  `);
  await carryOverLegacyColumns();
}

let legacyCarryOverDone = false;

/** One-time: if dbo.proponents still has the old nine columns (an environment that hasn't
 * been migrated yet), copies any non-blank values into this table, then drops them.
 * No-op on an environment where they're already gone. */
async function carryOverLegacyColumns() {
  if (legacyCarryOverDone) return;
  legacyCarryOverDone = true;
  try {
    const rows = await selectData(
      `SELECT COL_LENGTH('dbo.proponents', 'advance_lease_payment_months') AS l`
    );
    if (rows?.[0]?.l === null || rows?.[0]?.l === undefined) return; // already migrated

    for (const [prefix, type] of Object.entries(TERM_TYPES)) {
      await updateSchema(`
        INSERT INTO dbo.proponent_financial_terms (proponent_id, term_type, months, amount, currency, created_by)
        SELECT p.id, '${type}', p.${prefix}_months, p.${prefix}_amount, p.${prefix}_currency, p.created_by
        FROM dbo.proponents p
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.proponent_financial_terms t WHERE t.proponent_id = p.id AND t.term_type = '${type}'
        )
        AND (
          LTRIM(RTRIM(ISNULL(p.${prefix}_months, ''))) <> ''
          OR LTRIM(RTRIM(ISNULL(p.${prefix}_amount, ''))) <> ''
          OR LTRIM(RTRIM(ISNULL(p.${prefix}_currency, ''))) <> ''
        )
      `);
    }
    await updateSchema(`
      ALTER TABLE dbo.proponents DROP COLUMN
        advance_lease_payment_months, advance_lease_payment_amount, advance_lease_payment_currency,
        security_deposit_months, security_deposit_amount, security_deposit_currency,
        performance_security_months, performance_security_amount, performance_security_currency;
    `);
  } catch (error) {
    legacyCarryOverDone = false;
    console.error("Financial terms legacy column carry-over failed:", error);
  }
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Returns the flat { advance_lease_payment_months, advance_lease_payment_amount, ... }
 * shape the rest of the app (controller, locator form) already expects — callers don't
 * need to know this now lives in a child table instead of directly on dbo.proponents. */
async function getForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT term_type, months, amount, currency FROM dbo.proponent_financial_terms WHERE proponent_id = @param0 AND is_active = 1`,
    [proponentId]
  );
  const byType = new Map(rows.map((r) => [r.term_type, r]));
  const result = {};
  for (const [prefix, type] of Object.entries(TERM_TYPES)) {
    const row = byType.get(type);
    result[`${prefix}_months`] = row?.months ?? null;
    result[`${prefix}_amount`] = row?.amount ?? null;
    result[`${prefix}_currency`] = row?.currency ?? null;
  }
  return result;
}

/** Applies whichever of the nine flat fields are present in `fields` (create sends all
 * nine; update only sends the ones actually changing, same convention as every other
 * proponent field). A category's row is only touched when at least one of its three
 * fields is present, and is only created at all once one of them is. Runs inside the
 * caller's transaction, alongside the rest of the locator save. */
async function upsertForProponent(tx, proponentId, fields, actorId) {
  const actor = toInt(actorId);
  for (const [prefix, type] of Object.entries(TERM_TYPES)) {
    const monthsKey = `${prefix}_months`;
    const amountKey = `${prefix}_amount`;
    const currencyKey = `${prefix}_currency`;
    const touched = [monthsKey, amountKey, currencyKey].some((k) => fields[k] !== undefined);
    if (!touched) continue;

    const existing = await tx.query(
      `SELECT id FROM dbo.proponent_financial_terms WHERE proponent_id = @param0 AND term_type = @param1`,
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
      if (fields[monthsKey] !== undefined) pushSet("months", fields[monthsKey] ?? null);
      if (fields[amountKey] !== undefined) pushSet("amount", fields[amountKey] ?? null);
      if (fields[currencyKey] !== undefined) pushSet("currency", fields[currencyKey] ?? null);
      pushSet("updated_by", actor);
      await tx.query(
        `UPDATE dbo.proponent_financial_terms SET ${sets.join(", ")}, updated_at = GETDATE() WHERE id = @param0`,
        params
      );
    } else {
      await tx.query(
        `INSERT INTO dbo.proponent_financial_terms (proponent_id, term_type, months, amount, currency, created_by)
         VALUES (@param0, @param1, @param2, @param3, @param4, @param5)`,
        [proponentId, type, fields[monthsKey] ?? null, fields[amountKey] ?? null, fields[currencyKey] ?? null, actor]
      );
    }
  }
}

module.exports = { ensureSchema, getForProponent, upsertForProponent };
