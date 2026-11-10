/**
 * dbo.proponent_development_milestones — a locator's Development Timeline
 * (Performance Commitment card, item 4-11): four fixed milestones, each with
 * the date it happened and remarks. One row per milestone per locator, made
 * the first time it has something in it; saved with the card's own Save.
 */
const { selectData, updateSchema, runInTransaction } = require("../config/database");

/** The milestones, in order. Codes are what's stored. */
const MILESTONES = [
  { code: "A", label: "Submission of Construction Plans" },
  { code: "B", label: "Start of Construction" },
  { code: "C", label: "Completion of Construction" },
  { code: "D", label: "Start of Operation" },
];
const CODES = new Set(MILESTONES.map((m) => m.code));

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
      IF OBJECT_ID('dbo.proponent_development_milestones', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.proponent_development_milestones (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          proponent_id INT NOT NULL,
          milestone_code NVARCHAR(5) NOT NULL,
          milestone_date DATE NULL,
          remarks NVARCHAR(500) NULL,
          created_by INT NULL,
          created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_milestones_created_at DEFAULT (SYSUTCDATETIME()),
          updated_by INT NULL,
          updated_at DATETIME2(3) NULL,
          CONSTRAINT FK_proponent_milestones_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE,
          CONSTRAINT UX_proponent_milestones_proponent_code UNIQUE (proponent_id, milestone_code)
        );
      END
    `).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/** [{ code, label, date, remarks }] for all four milestones (blank when not set). */
async function getForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT milestone_code, milestone_date, remarks FROM dbo.proponent_development_milestones WHERE proponent_id = @param0`,
    [toInt(proponentId)]
  );
  const byCode = new Map(rows.map((r) => [String(r.milestone_code), r]));
  return MILESTONES.map((m) => ({
    code: m.code,
    label: m.label,
    date: ymd(byCode.get(m.code)?.milestone_date),
    remarks: byCode.get(m.code)?.remarks ?? null,
  }));
}

/** Problem with the payload, or null. */
function validate(list) {
  if (!Array.isArray(list)) return "development_timeline must be a list";
  for (const item of list) {
    if (!CODES.has(String(item?.code))) return `Unknown milestone "${item?.code}"`;
    if (item?.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date))) return "Milestone dates must be dates";
    if (item?.remarks && String(item.remarks).length > 500) return "Milestone remarks must be 500 characters or fewer";
  }
  return null;
}

/** Upserts the given milestones (others untouched). */
async function saveForProponent(proponentId, list, actorId = null) {
  await ensureSchema();
  const pid = toInt(proponentId);
  await runInTransaction(async (tx) => {
    for (const item of list) {
      const date = item?.date ? String(item.date).slice(0, 10) : null;
      const remarks = String(item?.remarks ?? "").trim() || null;
      await tx.query(
        `MERGE dbo.proponent_development_milestones WITH (HOLDLOCK) AS t
         USING (SELECT @param0 AS proponent_id, @param1 AS milestone_code) AS s
         ON t.proponent_id = s.proponent_id AND t.milestone_code = s.milestone_code
         WHEN MATCHED THEN UPDATE SET milestone_date = CAST(@param2 AS DATE), remarks = @param3, updated_by = @param4, updated_at = GETDATE()
         WHEN NOT MATCHED AND (@param2 IS NOT NULL OR @param3 IS NOT NULL) THEN
           INSERT (proponent_id, milestone_code, milestone_date, remarks, created_by)
           VALUES (@param0, @param1, CAST(@param2 AS DATE), @param3, @param4);`,
        [pid, String(item.code), date, remarks, toInt(actorId)]
      );
    }
  });
  return getForProponent(pid);
}

module.exports = { MILESTONES, ensureSchema, getForProponent, validate, saveForProponent };
