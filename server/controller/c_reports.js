const Report = require("../models/Report");
const LocatorReport = require("../models/LocatorReport");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: publicErrorMessage(error) });
}

// A repeated query key (?status=A&status=B) parses to an array, which the
// SQL parameter can't take — only plain strings count as a filter.
function queryText(req, key) {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null;
}

function filtersFromQuery(req) {
  return {
    dateFrom: queryText(req, "dateFrom"),
    dateTo: queryText(req, "dateTo"),
    applicationType: queryText(req, "applicationType"),
    status: queryText(req, "status"),
    isRenewal: queryText(req, "isRenewal"),
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

const EXPORT_FORMATS = ["csv", "pdf", "xlsx"];
const EXPORT_FILTER_KEYS = ["dateFrom", "dateTo", "applicationType", "status", "isRenewal", "search", "nationality", "year", "quarter"];
const EXPORT_REPORTS = ["applications", "stockholders", "investments", "locator-status", "gis", "summary"];

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
      report: EXPORT_REPORTS.includes(body.report) ? body.report : "applications",
      format,
      rowCount: Number.isFinite(rowCount) && rowCount >= 0 ? Math.floor(rowCount) : null,
      filters,
    },
    req,
  });
  return res.json({ success: true });
};

exports.stockholders = async (req, res) => {
  try {
    const data = await Report.listStockholders();
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reports stockholders");
  }
};

exports.applications = async (req, res) => {
  try {
    const data = await Report.listApplications(filtersFromQuery(req));
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reports applications list");
  }
};

/** The period reports take ?year=2026&quarter=1 (no quarter = the whole
 * year); a bad period is a 400 with the reason. */
function periodReport(fn, label) {
  return async (req, res) => {
    let query;
    try {
      query = { year: queryText(req, "year"), quarter: queryText(req, "quarter") };
      LocatorReport.readPeriod(query);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    try {
      const data = await fn(query);
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, label);
    }
  };
}

exports.investments = periodReport(LocatorReport.getQuarterlyInvestments, "Reports quarterly investments");
exports.locatorStatus = periodReport(LocatorReport.getLocatorStatus, "Reports locator status");
exports.summary = periodReport(LocatorReport.getSummary, "Reports summary");

exports.gis = async (req, res) => {
  try {
    const data = await LocatorReport.getGisFiling();
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reports GIS filing");
  }
};
