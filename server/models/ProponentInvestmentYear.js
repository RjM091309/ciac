/**
 * dbo.proponent_investment_years — the Performance Commitment broken down per
 * lease year (item 4-10): investment and employees, committed vs actual, for
 * Year 1, Year 2, … of the lease. Saved with the card's own Save; the
 * overall figures (dbo.proponent_investment) are kept in step by the caller —
 * investment = the years' sum, employees = the highest year (headcount).
 */
const { selectData, updateSchema, runInTransaction } = require("../config/database");

const FIELDS = ["investment_commitment", "investment_actual", "employee_commitment", "employee_actual"];

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
      IF OBJECT_ID('dbo.proponent_investment_years', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.proponent_investment_years (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          proponent_id INT NOT NULL,
          year_no INT NOT NULL,
          investment_commitment NVARCHAR(50) NULL,
          investment_actual NVARCHAR(50) NULL,
          employee_commitment NVARCHAR(50) NULL,
          employee_actual NVARCHAR(50) NULL,
          created_by INT NULL,
          created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_investment_years_created_at DEFAULT (SYSUTCDATETIME()),
          updated_by INT NULL,
          updated_at DATETIME2(3) NULL,
          CONSTRAINT FK_proponent_investment_years_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE,
          CONSTRAINT UX_proponent_investment_years UNIQUE (proponent_id, year_no)
        );
      END
    `).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

/** [{ year_no, investment_commitment, investment_actual, employee_commitment, employee_actual }], Year 1 first. */
async function getForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT year_no, ${FIELDS.join(", ")} FROM dbo.proponent_investment_years WHERE proponent_id = @param0 ORDER BY year_no`,
    [toInt(proponentId)]
  );
  return rows.map((r) => ({
    year_no: r.year_no,
    ...Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? null])),
  }));
}

/** Problem with the payload, or null. */
function validate(list) {
  if (!Array.isArray(list)) return "investment_years must be a list";
  if (list.length > 100) return "Too many years";
  const seen = new Set();
  for (const item of list) {
    const year = toInt(item?.year_no);
    if (!year || year < 1) return "Each year needs a year number (1, 2, …)";
    if (seen.has(year)) return `Year ${year} is listed twice`;
    seen.add(year);
    for (const f of FIELDS) {
      const v = item?.[f];
      if (v !== null && v !== undefined && v !== "" && !Number.isFinite(Number(String(v).replace(/,/g, "")))) {
        return `Year ${year}: amounts must be numbers`;
      }
    }
  }
  return null;
}

const amount = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/** The overall figures the years add up to: investment summed, employees the highest year. */
function totals(list) {
  const sum = (f) => {
    const values = list.map((r) => amount(r[f])).filter((n) => n !== null);
    return values.length ? String(Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100) : null;
  };
  const max = (f) => {
    const values = list.map((r) => amount(r[f])).filter((n) => n !== null);
    return values.length ? String(Math.max(...values)) : null;
  };
  return {
    investment_commitment: sum("investment_commitment"),
    investment_actual: sum("investment_actual"),
    employee_commitment: max("employee_commitment"),
    employee_actual: max("employee_actual"),
  };
}

/** Replaces the locator's years with `list` (years left out are removed). */
async function saveForProponent(proponentId, list, actorId = null) {
  await ensureSchema();
  const pid = toInt(proponentId);
  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM dbo.proponent_investment_years WHERE proponent_id = @param0`, [pid]);
    for (const item of list) {
      const values = FIELDS.map((f) => {
        const v = String(item?.[f] ?? "").trim();
        return v || null;
      });
      if (values.every((v) => v === null)) continue; // an empty year isn't kept
      await tx.query(
        `INSERT INTO dbo.proponent_investment_years (proponent_id, year_no, ${FIELDS.join(", ")}, created_by)
         VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6)`,
        [pid, toInt(item.year_no), ...values, toInt(actorId)]
      );
    }
  });
  return getForProponent(pid);
}

module.exports = { ensureSchema, getForProponent, validate, totals, saveForProponent };
