// Audit log retention (Portal Settings → Security "Keep audit log for
// (years)"; 0 = forever). Once a day, entries older than that are deleted in
// small batches (so a big first purge doesn't lock the table), and the purge
// itself is recorded in the audit log.
const { selectData, updateData } = require("../config/database");
const { getters: site } = require("./siteSettings");
const AuditLog = require("../models/AuditLog");

const RUN_EVERY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 5 * 60 * 1000;
const BATCH = 5000;

async function run() {
  const years = Number(site.auditRetentionYears() || 0);
  if (!(years > 0)) return { deleted: 0, disabled: true };
  let deleted = 0;
  for (;;) {
    const result = await updateData(
      `DELETE TOP (${BATCH}) FROM dbo.audit_logs WHERE created_at < DATEADD(year, -@param0, SYSUTCDATETIME())`,
      [years]
    );
    const n = Number(result?.rowsAffected?.[0] ?? 0);
    deleted += n;
    if (n < BATCH) break;
  }
  if (deleted > 0) {
    const oldest = await selectData(`SELECT MIN(created_at) AS oldest FROM dbo.audit_logs`);
    await AuditLog.record({
      actorId: null,
      actorUsername: "system",
      action: "AUDIT_LOG_PURGED",
      entityType: "audit_log",
      details: { deleted, retention_years: years, oldest_kept: oldest?.[0]?.oldest ?? null },
    });
    console.log(`[audit-retention] deleted ${deleted} entr${deleted === 1 ? "y" : "ies"} older than ${years} year(s)`);
  }
  return { deleted };
}

let timer = null;
function start() {
  if (timer) return;
  const tick = () => run().catch((error) => console.error("Audit retention run failed:", error.message));
  setTimeout(tick, FIRST_RUN_AFTER_MS).unref?.();
  timer = setInterval(tick, RUN_EVERY_MS);
  timer.unref?.();
}

module.exports = { start, run };
