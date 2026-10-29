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

  const [statusRows, typeRows, renewalRows, trendRows, totalRow, permitStatusRows, inspectionStatusRows, inspectionResultRows, contractRows, topInvestments, leaseArea] =
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
        ${permitFilter.whereSql ? `${permitFilter.whereSql} AND` : "WHERE"}
          -- Same set as Renewal Tracking: not deleted, and in force (its
          -- application approved, or a permit with no application).
          p.is_active = 1 AND (p.application_id IS NULL OR a.status = 'APPROVED')
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
          -- A contract is "issued" once its application is approved (one saved
          -- before Approve is still a draft).
          AND a.status = 'APPROVED'
        `,
        params
      ),
      getTopInvestments(3),
      getLeaseArea(),
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
    top_investments: topInvestments,
    lease_area: leaseArea,
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

/** Stockholders report: every active locator with its stockholders, and
 * how many stockholders (and companies) there are per nationality.
 * Nationality is free text on the profile, so it's grouped case- and
 * space-insensitively ("Filipino" = "FILIPINO "); blank = Not specified. */
async function listStockholders() {
  await require("./Stockholder").ensureSchema();
  const rows = await selectData(`
    SELECT p.id AS proponent_id, p.ref_no, p.business_name,
           s.id AS stockholder_id, s.name, s.nationality, s.subscribed, s.paid, s.ownership
    FROM dbo.proponents p
    LEFT JOIN dbo.stockholder s ON s.proponent_id = p.id AND s.is_active = 1
    WHERE p.is_active = 1
    ORDER BY p.business_name, s.id
  `);
  const companies = new Map();
  for (const r of rows) {
    let c = companies.get(r.proponent_id);
    if (!c) {
      c = { proponent_id: r.proponent_id, ref_no: r.ref_no || null, business_name: r.business_name, stockholders: [] };
      companies.set(r.proponent_id, c);
    }
    if (r.stockholder_id == null) continue;
    const nationality = String(r.nationality || "").replace(/\s+/g, " ").trim().toUpperCase() || null;
    c.stockholders.push({
      name: r.name,
      nationality,
      subscribed: Number(r.subscribed) || 0,
      paid: Number(r.paid) || 0,
      ownership: Number(r.ownership) || 0,
    });
  }
  const list = [...companies.values()];
  const byNationality = new Map();
  for (const c of list) {
    const counts = {};
    for (const s of c.stockholders) {
      const key = s.nationality || "NOT SPECIFIED";
      counts[key] = (counts[key] || 0) + 1;
    }
    c.total = c.stockholders.length;
    c.nationalities = Object.entries(counts)
      .map(([nationality, count]) => ({ nationality, count }))
      .sort((a, b) => b.count - a.count || a.nationality.localeCompare(b.nationality));
    for (const { nationality, count } of c.nationalities) {
      const n = byNationality.get(nationality) || { nationality, stockholders: 0, companies: 0 };
      n.stockholders += count;
      n.companies += 1;
      byNationality.set(nationality, n);
    }
  }
  return {
    companies: list.filter((c) => c.total > 0),
    companies_without: list.filter((c) => c.total === 0).length,
    without: list
      .filter((c) => c.total === 0)
      .map(({ proponent_id, ref_no, business_name }) => ({ proponent_id, ref_no, business_name })),
    nationalities: [...byNationality.values()].sort((a, b) => b.stockholders - a.stockholders || a.nationality.localeCompare(b.nationality)),
  };
}

/** Investment figures are free text on the Investment tab ("1,500,000.00",
 * "₱ 1500000") — keep the digits and decimal point; anything that isn't a
 * positive number doesn't rank. */
function parseAmount(v) {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Top N registered locators by committed investment (G-11). Registered =
 * the Registered Locator list's rule (manually registered, or has an approved
 * application). Not tied to the applications filters: it's the current
 * standing of every locator. */
async function getTopInvestments(limit = 3) {
  await require("./Investment").ensureSchema();
  const rows = await selectData(`
    SELECT p.id AS proponent_id, p.ref_no, p.business_name, i.commitment, i.actual
    FROM dbo.proponent_investment i
    INNER JOIN dbo.proponents p ON p.id = i.proponent_id
    WHERE i.metric_type = 'INVESTMENT' AND i.is_active = 1 AND p.is_active = 1
      AND (p.is_manual_registration = 1
           OR EXISTS (SELECT 1 FROM dbo.applications a WHERE a.proponent_id = p.id AND a.status = 'APPROVED'))
  `);
  return rows
    .map((r) => ({
      proponent_id: r.proponent_id,
      ref_no: r.ref_no || null,
      business_name: r.business_name,
      commitment: parseAmount(r.commitment),
      actual: parseAmount(r.actual),
    }))
    .filter((r) => r.commitment !== null)
    .sort((a, b) => b.commitment - a.commitment || a.business_name.localeCompare(b.business_name))
    .slice(0, limit);
}

/** Total leased area in sqm across registered locators (G-12), split by
 * type of property. A locator's schedule has one row per period, so adding
 * every row would count the same lot once per year: per locator, only the
 * rows in effect today count — or, when none is (schedule ended or not yet
 * started), the rows of its latest period. */
async function getLeaseArea() {
  await require("./Proponent").ensureSchema(); // adds proponent_properties.is_active
  await require("./ProponentLease").ensureSchema(); // adds proponent_properties.lease_id
  // Only the current lease's schedule: a renewal's new lease starts with a copy
  // of the previous one, so counting every lease would double the area.
  const rows = await selectData(`
    SELECT pp.proponent_id, pp.date_from, pp.date_to, pp.type_of_property, pp.area_sqm
    FROM dbo.proponent_properties pp
    INNER JOIN dbo.proponents p ON p.id = pp.proponent_id
    WHERE pp.is_active = 1 AND p.is_active = 1
      AND (pp.lease_id IS NULL
           OR pp.lease_id IN (SELECT l.id FROM dbo.proponent_leases l WHERE l.is_current = 1 AND l.is_active = 1))
      AND (p.is_manual_registration = 1
           OR EXISTS (SELECT 1 FROM dbo.applications a WHERE a.proponent_id = p.id AND a.status = 'APPROVED'))
  `);
  // Compared as YYYY-MM-DD: DATE columns arrive as UTC midnight, so mixing
  // them with a local-time "today" would drop a period on its first day.
  const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const byLocator = new Map();
  for (const r of rows) {
    const area = parseAmount(r.area_sqm);
    if (area === null) continue;
    const list = byLocator.get(r.proponent_id) || [];
    list.push({ ...r, area });
    byLocator.set(r.proponent_id, list);
  }
  const byType = new Map();
  let total = 0;
  for (const list of byLocator.values()) {
    let counted = list.filter((r) => r.date_from && r.date_to && ymd(r.date_from) <= today && today <= ymd(r.date_to));
    if (counted.length === 0) {
      const latest = list.map((r) => ymd(r.date_from)).sort().pop();
      counted = list.filter((r) => ymd(r.date_from) === latest);
    }
    for (const r of counted) {
      const type = String(r.type_of_property || "").trim().toUpperCase() || "NOT SPECIFIED";
      byType.set(type, (byType.get(type) || 0) + r.area);
      total += r.area;
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    total_sqm: round(total),
    locators: byLocator.size,
    by_type: [...byType.entries()].map(([type, sqm]) => ({ type, sqm: round(sqm) })).sort((a, b) => b.sqm - a.sqm),
  };
}

module.exports = {
  getOverview,
  getTopInvestments,
  getLeaseArea,
  listApplications,
  listStockholders,
};
