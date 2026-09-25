const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

const FILTER_KEYS = ["q", "qActions", "user", "action", "category", "entityType", "entityId", "session", "from", "to"];
// qActions is a comma-separated list of action codes, so it gets more room.
const MAX_LENGTH = { qActions: 2000 };

/** The filters the Audit Log page sends, as trimmed strings (unset ones
 * dropped) — shared by the page listing and the CSV export. */
function filtersFromQuery(query = {}) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value != null && String(value).trim() !== "") filters[key] = String(value).trim().slice(0, MAX_LENGTH[key] || 100);
  }
  return filters;
}

exports.list = async (req, res) => {
  try {
    const { page, pageSize } = req.query || {};
    const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const pageNum = Math.max(Number(page) || 1, 1);
    const { rows, total } = await AuditLog.list({
      ...filtersFromQuery(req.query),
      limit: size,
      offset: (pageNum - 1) * size,
    });
    return res.json({ success: true, data: rows, total, page: pageNum, pageSize: size });
  } catch (error) {
    console.error("List audit logs error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** Rows for the page's CSV download. The page formats the file (so it reads
 * the same as the table); the export itself is logged here, where the data
 * actually leaves the server. */
exports.exportRows = async (req, res) => {
  try {
    const filters = filtersFromQuery(req.query);
    const { rows, total, limit } = await AuditLog.listForExport(filters);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "AUDIT_LOG_EXPORTED",
      entityType: "report",
      // qActions is derived from the search text — logging the text is enough.
      details: {
        report: "audit_log",
        format: "xlsx",
        rowCount: rows.length,
        totalMatching: total,
        filters: Object.fromEntries(Object.entries(filters).filter(([k]) => k !== "qActions")),
      },
      req,
    });
    return res.json({ success: true, data: rows, total, limit });
  } catch (error) {
    console.error("Export audit logs error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.listActions = async (req, res) => {
  try {
    const actions = await AuditLog.listDistinctActions();
    const categories = Object.fromEntries(actions.map((a) => [a, AuditLog.categoryOf(a)]));
    return res.json({ success: true, data: actions, categories });
  } catch (error) {
    console.error("List audit log actions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
