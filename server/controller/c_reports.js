const Report = require("../models/Report");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: error.message || "Internal server error" });
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

exports.applications = async (req, res) => {
  try {
    const data = await Report.listApplications(filtersFromQuery(req));
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reports applications list");
  }
};
