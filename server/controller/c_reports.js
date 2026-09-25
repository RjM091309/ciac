const Report = require("../models/Report");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: publicErrorMessage(error) });
}

function filtersFromQuery(req) {
  return {
    dateFrom: req.query.dateFrom || null,
    dateTo: req.query.dateTo || null,
    applicationType: req.query.applicationType || null,
    status: req.query.status || null,
    isRenewal: req.query.isRenewal || null,
  };
}

exports.overview = async (req, res) => {
  try {
    const data = await Report.getOverview(filtersFromQuery(req));
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reports overview");
  }
};

const EXPORT_FORMATS = ["csv", "pdf"];
const EXPORT_FILTER_KEYS = ["dateFrom", "dateTo", "applicationType", "status", "isRenewal", "search"];

/** The Reports page builds its CSV/PDF in the browser from data it already
 * fetched, so the server never sees the file itself — the page reports each
 * export here so the audit log still shows who took which data out. */
exports.logExport = async (req, res) => {
  const body = req.body || {};
  const format = String(body.format || "").toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({ success: false, message: "Unknown export format" });
  }
  const filters = {};
  for (const key of EXPORT_FILTER_KEYS) {
    const value = body.filters?.[key];
    if (value != null && String(value).trim() !== "") filters[key] = String(value).trim().slice(0, 100);
  }
  const rowCount = Number(body.rowCount);
  await AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action: "REPORT_EXPORTED",
    entityType: "report",
    details: {
      report: "applications",
      format,
      rowCount: Number.isFinite(rowCount) && rowCount >= 0 ? Math.floor(rowCount) : null,
      filters,
    },
    req,
  });
  return res.json({ success: true });
};

exports.applications = async (req, res) => {
  try {
    const data = await Report.listApplications(filtersFromQuery(req));
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reports applications list");
  }
};
