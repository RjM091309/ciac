const { selectData } = require("../config/database");
const { effectiveStatus } = require("./Permit");

// Applications with a blank/NULL type code are reported (and filterable) as
// "Unspecified" under this sentinel code instead of an empty label.
const NO_TYPE_CODE = "__NONE__";
const TYPE_CODE_SQL = "NULLIF(LTRIM(RTRIM(a.application_type)), '')";
const TYPE_NAME_SQL = `COALESCE(NULLIF(at.name, ''), ${TYPE_CODE_SQL}, 'Unspecified')`;

function typeFilterClause(applicationType, params) {
  if (applicationType === NO_TYPE_CODE) return `${TYPE_CODE_SQL} IS NULL`;
  const clause = `a.application_type = @param${params.length}`;
  params.push(applicationType);
  return clause;
}

function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Shared WHERE-clause builder for the applications table — every report
 * query (overview charts + the exportable list) filters the same way, so
 * status/type/date-range stay consistent between the dashboard numbers and
 * whatever a user then exports. */
function buildApplicationsFilter({ dateFrom, dateTo, applicationType, status, isRenewal } = {}) {
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
    where.push(typeFilterClause(applicationType, params));
  }
  if (status) {
    where.push(`a.status = @param${params.length}`);
    params.push(status);
  }
  if (isRenewal === "new" || isRenewal === "renewal") {
    where.push(`a.is_renewal = @param${params.length}`);
    params.push(isRenewal === "renewal" ? 1 : 0);
  }
  return { whereSql: `WHERE ${where.join(" AND ")}`, params };
}

/** Filter builder for permits/inspections, which don't carry their own
 * status/type — only date range (on the record's own created_at) and
 * application type (via a join back to dbo.applications) apply. The
 * applications `status` filter is deliberately not applied here: permit
 * and inspection status vocabularies (VALID/EXPIRED/… , SCHEDULED/COMPLETED/…)
 * don't correspond to application statuses (SUBMITTED/APPROVED/…). */
function buildLinkedFilter({ dateFrom, dateTo, applicationType } = {}, alias) {
  const where = [];
  const params = [];
  const from = toDateOrNull(dateFrom);
  const to = toDateOrNull(dateTo);
  if (from) {
    where.push(`${alias}.created_at >= @param${params.length}`);
    params.push(from);
  }
  if (to) {
    where.push(`${alias}.created_at <= @param${params.length}`);
    params.push(to);
  }
  if (applicationType) {
    where.push(typeFilterClause(applicationType, params));
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

async function getOverview(filters = {}) {
  const { whereSql, params } = buildApplicationsFilter(filters);
  const permitFilter = buildLinkedFilter(filters, "p");
  const inspectionFilter = buildLinkedFilter(filters, "i");

  const [statusRows, typeRows, renewalRows, trendRows, totalRow, permitStatusRows, inspectionStatusRows, inspectionResultRows, contractRows] =
    await Promise.all([
      selectData(
        `SELECT a.status, COUNT(1) AS total FROM dbo.applications a ${whereSql} GROUP BY a.status`,
        params
      ),
      selectData(
        `
        SELECT t.application_type, t.type_name, COUNT(1) AS total
        FROM (
          SELECT ISNULL(${TYPE_CODE_SQL}, '${NO_TYPE_CODE}') AS application_type, ${TYPE_NAME_SQL} AS type_name
          FROM dbo.applications a
          LEFT JOIN dbo.application_types at ON at.code = a.application_type
          ${whereSql}
        ) t
        GROUP BY t.application_type, t.type_name
        ORDER BY total DESC
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
      selectData(
        `
        SELECT p.status, p.expiry_date
        FROM dbo.permits p
        LEFT JOIN dbo.applications a ON a.id = p.application_id
        ${permitFilter.whereSql}
        `,
        permitFilter.params
      ),
      selectData(
        `
        SELECT i.status, COUNT(1) AS total
        FROM dbo.inspections i
        LEFT JOIN dbo.applications a ON a.id = i.application_id
        ${inspectionFilter.whereSql}
        GROUP BY i.status
        `,
        inspectionFilter.params
      ),
      selectData(
        `
        SELECT i.result, COUNT(1) AS total
        FROM dbo.inspections i
        LEFT JOIN dbo.applications a ON a.id = i.application_id
        ${inspectionFilter.whereSql ? `${inspectionFilter.whereSql} AND i.result IS NOT NULL` : "WHERE i.result IS NOT NULL"}
        GROUP BY i.result
        `,
        inspectionFilter.params
      ),
      selectData(
        `
        SELECT COUNT(1) AS total
        FROM dbo.contracts c
        INNER JOIN dbo.applications a ON a.id = c.application_id
        ${whereSql}
        `,
        params
      ),
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

  // Effective status (VALID/EXPIRING/EXPIRED/REVOKED) is derived from expiry_date
  // at read time, not stored on the row — tally with the same function the
  // Permit & Contract page uses so this breakdown matches what staff see there.
  const permitsByStatus = {};
  permitStatusRows.forEach((r) => {
    const s = effectiveStatus(r);
    permitsByStatus[s] = (permitsByStatus[s] || 0) + 1;
  });

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
      ${TYPE_NAME_SQL} AS application_type_name,
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
