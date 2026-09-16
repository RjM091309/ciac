const { selectData } = require("../config/database");

function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Shared WHERE-clause builder for the applications table — every report
 * query (overview charts + the exportable list) filters the same way, so
 * status/type/date-range stay consistent between the dashboard numbers and
 * whatever a user then exports. */
function buildApplicationsFilter({ dateFrom, dateTo, applicationType, status } = {}) {
  const where = ["a.status <> 'DRAFT'"];
  const params = [];
  const from = toDateOrNull(dateFrom);
  const to = toDateOrNull(dateTo);
  if (from) {
    where.push(`a.created_at >= @param${params.length}`);
    params.push(from);
  }
  if (to) {
    where.push(`a.created_at <= @param${params.length}`);
    params.push(to);
  }
  if (applicationType) {
    where.push(`a.application_type = @param${params.length}`);
    params.push(applicationType);
  }
  if (status) {
    where.push(`a.status = @param${params.length}`);
    params.push(status);
  }
  return { whereSql: `WHERE ${where.join(" AND ")}`, params };
}

async function getOverview(filters = {}) {
  const { whereSql, params } = buildApplicationsFilter(filters);

  const [statusRows, typeRows, renewalRows, trendRows, totalRow, permitStatusRows, inspectionStatusRows, inspectionResultRows, contractRows] =
    await Promise.all([
      selectData(
        `SELECT a.status, COUNT(1) AS total FROM dbo.applications a ${whereSql} GROUP BY a.status`,
        params
      ),
      selectData(
        `
        SELECT a.application_type, ISNULL(at.name, a.application_type) AS type_name, COUNT(1) AS total
        FROM dbo.applications a
        LEFT JOIN dbo.application_types at ON at.code = a.application_type
        ${whereSql}
        GROUP BY a.application_type, ISNULL(at.name, a.application_type)
        `,
        params
      ),
      selectData(
        `SELECT a.is_renewal, COUNT(1) AS total FROM dbo.applications a ${whereSql} GROUP BY a.is_renewal`,
        params
      ),
      selectData(
        `
        SELECT FORMAT(a.created_at, 'yyyy-MM') AS ym, COUNT(1) AS total
        FROM dbo.applications a
        ${whereSql}
        GROUP BY FORMAT(a.created_at, 'yyyy-MM')
        ORDER BY ym
        `,
        params
      ),
      selectData(`SELECT COUNT(1) AS total FROM dbo.applications a ${whereSql}`, params),
      selectData(`SELECT status, COUNT(1) AS total FROM dbo.permits GROUP BY status`),
      selectData(`SELECT status, COUNT(1) AS total FROM dbo.inspections GROUP BY status`),
      selectData(
        `SELECT result, COUNT(1) AS total FROM dbo.inspections WHERE result IS NOT NULL GROUP BY result`
      ),
      selectData(`SELECT COUNT(1) AS total FROM dbo.contracts`),
    ]);

  const byStatus = {};
  statusRows.forEach((r) => { byStatus[String(r.status)] = Number(r.total || 0); });

  const byType = typeRows.map((r) => ({
    code: r.application_type,
    name: r.type_name,
    total: Number(r.total || 0),
  }));

  const renewalMap = { new: 0, renewal: 0 };
  renewalRows.forEach((r) => {
    const isRenewal = Number(r.is_renewal) === 1 || r.is_renewal === true;
    renewalMap[isRenewal ? "renewal" : "new"] = Number(r.total || 0);
  });

  const monthlyTrend = trendRows.map((r) => ({ month: r.ym, total: Number(r.total || 0) }));

  const permitsByStatus = {};
  permitStatusRows.forEach((r) => { permitsByStatus[String(r.status)] = Number(r.total || 0); });

  const inspectionsByStatus = {};
  inspectionStatusRows.forEach((r) => { inspectionsByStatus[String(r.status)] = Number(r.total || 0); });

  const inspectionsByResult = {};
  inspectionResultRows.forEach((r) => { inspectionsByResult[String(r.result)] = Number(r.total || 0); });

  return {
    total_applications: Number(totalRow?.[0]?.total || 0),
    applications_by_status: byStatus,
    applications_by_type: byType,
    applications_new_vs_renewal: renewalMap,
    monthly_trend: monthlyTrend,
    permits_by_status: permitsByStatus,
    inspections_by_status: inspectionsByStatus,
    inspections_by_result: inspectionsByResult,
    contracts_issued: Number(contractRows?.[0]?.total || 0),
  };
}

/** Row-level detail behind the overview — the same filtered set, but one row
 * per application, for the on-screen table and the PDF/Excel export. */
async function listApplications(filters = {}) {
  const { whereSql, params } = buildApplicationsFilter(filters);
  return selectData(
    `
    SELECT
      a.id,
      a.application_no,
      p.business_name AS proponent_name,
      a.application_type,
      ISNULL(at.name, a.application_type) AS application_type_name,
      a.is_renewal,
      a.status,
      a.submitted_at,
      a.created_at,
      a.updated_at
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    LEFT JOIN dbo.application_types at ON at.code = a.application_type
    ${whereSql}
    ORDER BY a.created_at DESC
    `,
    params
  );
}

module.exports = {
  getOverview,
  listApplications,
};
