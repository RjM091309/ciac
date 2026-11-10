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
const EXPORT_FILTER_KEYS = ["dateFrom", "dateTo", "applicationType", "status", "isRenewal", "search", "nationality", "year", "quarter", "dataset", "columns", "template"];
const EXPORT_REPORTS = ["applications", "stockholders", "investments", "locator-status", "gis", "summary", "custom"];

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

/* ------------------------------ Custom Report ------------------------------ */
// The user picks the dataset, columns and filters (models/CustomReport.js);
// the file itself is built in the browser and logged through /export-log.
const CustomReport = require("../models/CustomReport");
const { aoLevel2Id } = require("../lib/departments");

exports.customCatalog = async (req, res) => {
  try {
    return res.json({ success: true, data: await CustomReport.catalog(), maxRows: CustomReport.MAX_ROWS });
  } catch (error) {
    return fail(res, error, "Custom report catalog");
  }
};

exports.customRun = async (req, res) => {
  try {
    const b = req.body || {};
    const data = await CustomReport.run({
      dataset: String(b.dataset || ""),
      columns: b.columns,
      filters: b.filters,
      sort: b.sort,
      // A Level 2 Account Officer: only their own locators.
      ownOfficerId: await aoLevel2Id(req.user),
      limit: b.limit,
    });
    return res.json({ success: true, data });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    return fail(res, error, "Custom report");
  }
};

// "Total ___ by ___ as of / in [year]".
exports.customQuickTotal = async (req, res) => {
  try {
    const b = req.body || {};
    const data = await CustomReport.quickTotal({
      measure: String(b.measure || ""),
      by: String(b.by || ""),
      period: b.period === "in" ? "in" : "asof",
      year: b.year,
      filters: b.filters,
      ownOfficerId: await aoLevel2Id(req.user),
    });
    return res.json({ success: true, data });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    return fail(res, error, "Quick total");
  }
};

exports.customQuickTotalOptions = async (req, res) => res.json({ success: true, data: CustomReport.quickTotalOptions() });

exports.customTemplates = async (req, res) => {
  try {
    return res.json({ success: true, data: await CustomReport.listTemplates(req.user.id) });
  } catch (error) {
    return fail(res, error, "Custom report templates");
  }
};

exports.saveCustomTemplate = async (req, res) => {
  try {
    const id = await CustomReport.saveTemplate(req.user.id, req.body || {});
    return res.json({ success: true, data: { id, templates: await CustomReport.listTemplates(req.user.id) } });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    return fail(res, error, "Save custom report template");
  }
};

// Emails a test copy of a template's monthly report to the user asking.
exports.sendCustomTemplateTest = async (req, res) => {
  try {
    const r = await require("../lib/monthlyReports").sendTest(req.params.id, req.user);
    if (!r.sent) {
      const why = r.reason === "SMTP_NOT_CONFIGURED" ? "Email isn't set up (Portal Settings → Email)." : "The email could not be sent.";
      return res.status(502).json({ success: false, message: why });
    }
    return res.json({ success: true, data: r });
  } catch (error) {
    if (error.status === 400 || error.status === 404) return res.status(error.status).json({ success: false, message: error.message });
    return fail(res, error, "Send monthly report test");
  }
};

// Who gets the monthly reports (shown beside the Recurring checkbox).
exports.monthlyReportRecipients = async (req, res) => {
  try {
    const list = await require("../lib/monthlyReports").recipients();
    return res.json({ success: true, data: list.map((r) => ({ name: r.name, email: r.email, own_only: r.ownOnly })) });
  } catch (error) {
    return fail(res, error, "Monthly report recipients");
  }
};

exports.deleteCustomTemplate = async (req, res) => {
  try {
    const ok = await CustomReport.deleteTemplate(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: "Template not found" });
    return res.json({ success: true, data: await CustomReport.listTemplates(req.user.id) });
  } catch (error) {
    return fail(res, error, "Delete custom report template");
  }
};
