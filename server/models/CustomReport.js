// Custom Report (Reports & Analytics → Custom Report): the user picks a
// dataset, the columns and the filters, previews the rows and exports them
// (Excel / CSV built in the browser). Every column, filter and sort is from
// the catalog below — nothing the client sends goes into the SQL as text, only
// as parameters. A Level 2 Account Officer sees only their own locators.
// Saved setups ("templates") are per user (dbo.report_templates).
const { selectData, updateData, updateSchema, insertData } = require("../config/database");
const { decryptValue } = require("../lib/crypto");

const MAX_ROWS = 10000;
// Filter key: rows where this column (a key from the dataset) is empty.
const MISSING_FILTER = "missing";

/** A staff user's real name for a report ("Chester Tayag"), not the
 * "AO - Chester_T" label full_name holds (lib/staffName.js). */
const personName = (alias) =>
  `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name))), ''), ${alias}.full_name)`;

// The locator's Type of Contract, same order as the Registered Locator panel:
// the approved contract's, else the latest application's, else the encoded one.
const CONTRACT_TYPE_APPLY = `
  OUTER APPLY (
    SELECT TOP (1) c.contract_type_id, c.effective_start, c.effective_end
    FROM dbo.contracts c
    INNER JOIN dbo.applications ca ON ca.id = c.application_id
    WHERE ca.proponent_id = p.id AND ca.status = 'APPROVED'
    ORDER BY c.effective_end DESC, c.id DESC
  ) ct
  OUTER APPLY (
    SELECT TOP (1) la.contract_type_id, la.application_type
    FROM dbo.applications la
    WHERE la.proponent_id = p.id
    ORDER BY CASE WHEN la.status = 'APPROVED' THEN 0 ELSE 1 END, la.created_at DESC, la.id DESC
  ) latest_app
  LEFT JOIN dbo.type_of_contract toc ON toc.id = COALESCE(ct.contract_type_id, latest_app.contract_type_id, p.contract_type_id)
  LEFT JOIN dbo.application_types ind ON ind.code = COALESCE(latest_app.application_type, p.industry_code)
  LEFT JOIN dbo.users ao ON ao.id = p.account_officer_id
  LEFT JOIN dbo.land_use lu ON lu.id = p.land_use_id
  LEFT JOIN dbo.proponents sublessor ON sublessor.id = p.sublessor_id
`;

// Registered Locators: where the locator's lease stands. The lease ends on the
// End Term, or on the latest Extension Date when that is later; a renewal that
// has been filed but not yet decided outranks the rest (same as the panel's
// "Renewal in process" badge).
const LEASE_APPLY = `
  CROSS APPLY (
    SELECT CASE
      WHEN p.extension_date IS NOT NULL
        AND (COALESCE(ct.effective_end, p.manual_end_term) IS NULL
          OR CAST(p.extension_date AS DATE) > CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE))
      THEN CAST(p.extension_date AS DATE)
      ELSE CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE)
    END AS eff_end
  ) le
  OUTER APPLY (
    SELECT TOP (1) r.application_no
    FROM dbo.applications r
    WHERE r.proponent_id = p.id AND r.is_renewal = 1
      AND r.status NOT IN ('DRAFT', 'APPROVED', 'REJECTED', 'DISAPPROVED')
    ORDER BY r.id DESC
  ) open_ren
`;
const EXPIRING_DAYS = 90;
const LEASE_STATUS_SQL = `CASE
    WHEN open_ren.application_no IS NOT NULL THEN 'Renewal in process'
    WHEN le.eff_end IS NULL THEN 'No lease term'
    WHEN le.eff_end < CAST(GETDATE() AS DATE) THEN 'Expired'
    WHEN le.eff_end <= DATEADD(day, ${EXPIRING_DAYS}, CAST(GETDATE() AS DATE)) THEN 'Expiring soon'
    ELSE 'Active'
  END`;

/** A locator's committed / actual investment or employee figure (text). */
const invSql = (metric, field) =>
  `(SELECT TOP (1) NULLIF(LTRIM(RTRIM(i.${field})), '') FROM dbo.proponent_investment i WHERE i.proponent_id = p.id AND i.metric_type = '${metric}' AND i.is_active = 1 ORDER BY i.id DESC)`;

/** Locator columns shared by the datasets built on dbo.proponents p. */
const LOCATOR_COLUMNS = {
  ref_code: { label: "Ref. Code", sql: "p.ref_code" },
  ref_no: { label: "Ref No", sql: "p.ref_no" },
  business_name: { label: "Locator", sql: "p.business_name" },
  nationality: { label: "Nationality", sql: "p.nationality" },
  type_of_contract: { label: "Type of Contract", sql: "toc.name" },
  industry: { label: "Industry", sql: "ind.name" },
  account_officer: { label: "Account Officer", sql: personName("ao") },
};

// A Registered Locator: assigned an Account Officer, or registered by hand /
// imported from BRIDGE (those wait for Level 1 to assign one).
const REGISTERED = "(p.account_officer_id IS NOT NULL OR p.is_manual_registration = 1)";

const DATASETS = {
  locators: {
    label: "Registered Locators",
    description: "One row per registered locator.",
    from: `FROM dbo.proponents p ${CONTRACT_TYPE_APPLY} ${LEASE_APPLY}`,
    where: [REGISTERED],
    order: "p.business_name",
    columns: {
      ...LOCATOR_COLUMNS,
      registration_no: { label: "SEC Registration No.", sql: "p.registration_no" },
      tin: { label: "TIN", sql: "p.tin", decrypt: true },
      address: { label: "Principal Address", sql: "p.address" },
      lease_address: { label: "Lease Address", sql: "p.lease_address" },
      location: { label: "Location", sql: "p.location" },
      land_use: { label: "Land Use", sql: "lu.name" },
      contact_no: { label: "Contact No.", sql: "p.contact_no" },
      business_activities: { label: "Business Activities", sql: "p.business_activities" },
      date_signed: { label: "Date Signed", sql: "p.date_signed", type: "date" },
      start_term: { label: "Start Term", sql: "COALESCE(ct.effective_start, p.manual_start_term)", type: "date" },
      end_term: { label: "End Term", sql: "COALESCE(ct.effective_end, p.manual_end_term)", type: "date" },
      extension_date: { label: "Extension Date", sql: "p.extension_date", type: "date" },
      sublessor: { label: "Sub-lessee of", sql: "sublessor.business_name" },
      lease_end: { label: "Lease Ends (with extension)", sql: "le.eff_end", type: "date" },
      days_left: { label: "Days Left", sql: "DATEDIFF(day, CAST(GETDATE() AS DATE), le.eff_end)", type: "number" },
      lease_status: { label: "Lease Status", sql: LEASE_STATUS_SQL, noMissing: true },
      renewal_application_no: { label: "Renewal Application No.", sql: "open_ren.application_no" },
      status: { label: "Record Status", sql: "CASE WHEN p.is_active = 1 THEN 'Active' ELSE 'Inactive' END", noMissing: true },
      created_at: { label: "Encoded On", sql: "p.created_at", type: "date" },
      // Investments: committed (on registration) and actual (realized).
      investment_committed: { label: "Investment – Committed", sql: invSql("INVESTMENT", "commitment"), type: "number" },
      investment_actual: { label: "Investment – Actual", sql: invSql("INVESTMENT", "actual"), type: "number" },
      employees_committed: { label: "Employees – Committed", sql: invSql("EMPLOYEE_COUNT", "commitment"), type: "number" },
      employees_actual: { label: "Employees – Actual", sql: invSql("EMPLOYEE_COUNT", "actual"), type: "number" },
    },
    defaults: ["ref_code", "business_name", "nationality", "type_of_contract", "account_officer", "start_term", "end_term", "lease_status"],
    filters: {
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
      nationality: { label: "Nationality", type: "select", options: "nationalities", sql: "UPPER(LTRIM(RTRIM(p.nationality))) = @v" },
      lease_status: { label: "Lease Status", type: "select", options: "leaseStatuses", sql: `${LEASE_STATUS_SQL} = @v` },
      expires_within: {
        label: "Expires within",
        type: "select",
        options: "expiresWithin",
        sql: "le.eff_end >= CAST(GETDATE() AS DATE) AND le.eff_end <= DATEADD(day, TRY_CAST(@v AS INT), CAST(GETDATE() AS DATE))",
      },
      status: { label: "Record Status", type: "select", options: "activeStatus", sql: "p.is_active = @v" },
      end_from: { label: "End Term from", type: "date", sql: "CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE) >= @v" },
      end_to: { label: "End Term to", type: "date", sql: "CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE) <= @v" },
      start_from: { label: "Start Term from", type: "date", sql: "CAST(COALESCE(ct.effective_start, p.manual_start_term) AS DATE) >= @v" },
      start_to: { label: "Start Term to", type: "date", sql: "CAST(COALESCE(ct.effective_start, p.manual_start_term) AS DATE) <= @v" },
      signed_from: { label: "Date Signed from", type: "date", sql: "CAST(p.date_signed AS DATE) >= @v" },
      signed_to: { label: "Date Signed to", type: "date", sql: "CAST(p.date_signed AS DATE) <= @v" },
      created_from: { label: "Encoded On from", type: "date", sql: "CAST(p.created_at AS DATE) >= @v" },
      created_to: { label: "Encoded On to", type: "date", sql: "CAST(p.created_at AS DATE) <= @v" },
    },
  },

  applications: {
    label: "Applications",
    description: "One row per filed application (new and renewal).",
    from: `FROM dbo.applications a
      INNER JOIN dbo.proponents p ON p.id = a.proponent_id
      LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
      LEFT JOIN dbo.users ev ON ev.id = asm.assigned_evaluator_id
      LEFT JOIN dbo.type_of_contract atoc ON atoc.id = a.contract_type_id
      LEFT JOIN dbo.application_types aind ON aind.code = a.application_type
      OUTER APPLY (SELECT TOP (1) c.contract_no, c.effective_start, c.effective_end FROM dbo.contracts c WHERE c.application_id = a.id ORDER BY c.id DESC) actr`,
    where: ["a.status <> 'DRAFT'"],
    order: "a.id DESC",
    columns: {
      application_no: { label: "Application No.", sql: "a.application_no" },
      track: { label: "New / Renewal", sql: "CASE WHEN a.is_renewal = 1 THEN 'Renewal' ELSE 'New' END", noMissing: true },
      business_name: { label: "Proponent / Locator", sql: "p.business_name" },
      ref_code: { label: "Ref. Code", sql: "p.ref_code" },
      nationality: { label: "Nationality", sql: "p.nationality" },
      industry: { label: "Industry", sql: "aind.name" },
      type_of_contract: { label: "Type of Contract", sql: "atoc.name" },
      status: { label: "Status", sql: "a.status" },
      stage: { label: "Evaluation Stage", sql: "asm.stage" },
      evaluator: { label: "Evaluator", sql: personName("ev") },
      submitted_at: { label: "Submitted", sql: "COALESCE(a.submitted_at, a.created_at)", type: "date" },
      contract_no: { label: "Contract No.", sql: "actr.contract_no" },
      contract_start: { label: "Contract Start", sql: "actr.effective_start", type: "date" },
      contract_end: { label: "Contract End", sql: "actr.effective_end", type: "date" },
    },
    defaults: ["application_no", "track", "business_name", "type_of_contract", "status", "evaluator", "submitted_at"],
    filters: {
      track: { label: "New / Renewal", type: "select", options: "tracks", sql: "a.is_renewal = @v" },
      status: { label: "Status", type: "select", options: "applicationStatuses", sql: "a.status = @v" },
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "a.contract_type_id = @v" },
      submitted_from: { label: "Submitted from", type: "date", sql: "CAST(COALESCE(a.submitted_at, a.created_at) AS DATE) >= @v" },
      submitted_to: { label: "Submitted to", type: "date", sql: "CAST(COALESCE(a.submitted_at, a.created_at) AS DATE) <= @v" },
    },
  },

  stockholders: {
    label: "Stockholders",
    description: "One row per stockholder of a registered locator.",
    from: `FROM dbo.stockholder s INNER JOIN dbo.proponents p ON p.id = s.proponent_id ${CONTRACT_TYPE_APPLY}`,
    where: ["s.is_active = 1", REGISTERED],
    order: "p.business_name, s.id",
    columns: {
      ...LOCATOR_COLUMNS,
      stockholder: { label: "Stockholder", sql: "s.name" },
      stockholder_nationality: { label: "Stockholder Nationality", sql: "s.nationality" },
      subscribed: { label: "Subscribed", sql: "s.subscribed", type: "number" },
      paid: { label: "Paid", sql: "s.paid", type: "number" },
      ownership: { label: "Ownership %", sql: "s.ownership", type: "number" },
    },
    defaults: ["ref_code", "business_name", "stockholder", "stockholder_nationality", "subscribed", "paid", "ownership"],
    filters: {
      stockholder_nationality: { label: "Stockholder Nationality", type: "select", options: "nationalities", sql: "UPPER(LTRIM(RTRIM(s.nationality))) = @v" },
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
    },
  },

  leases: {
    label: "Lease Agreements",
    description: "One row per lease — the current one and earlier ones.",
    from: `FROM dbo.proponent_leases l
      INNER JOIN dbo.proponents p ON p.id = l.proponent_id
      LEFT JOIN dbo.contracts lc ON lc.id = l.contract_id
      LEFT JOIN dbo.type_of_contract ltoc ON ltoc.id = COALESCE(l.contract_type_id, lc.contract_type_id)
      LEFT JOIN dbo.users ao ON ao.id = p.account_officer_id`,
    where: ["l.is_active = 1", REGISTERED],
    order: "p.business_name, l.is_current DESC, l.id DESC",
    columns: {
      business_name: { label: "Locator", sql: "p.business_name" },
      ref_no: { label: "Ref No", sql: "p.ref_no" },
      lease_ref_code: { label: "Lease Ref. Code", sql: "l.ref_code" },
      type_of_contract: { label: "Type of Contract", sql: "ltoc.name" },
      account_officer: { label: "Account Officer", sql: personName("ao") },
      contract_no: { label: "Contract No.", sql: "lc.contract_no" },
      date_signed: { label: "Date Signed", sql: "l.date_signed", type: "date" },
      start_term: { label: "Start Term", sql: "COALESCE(lc.effective_start, l.start_term)", type: "date" },
      end_term: { label: "End Term", sql: "COALESCE(lc.effective_end, l.end_term)", type: "date" },
      current: { label: "Lease", sql: "CASE WHEN l.is_current = 1 THEN 'Current' ELSE 'Earlier' END" },
    },
    defaults: ["lease_ref_code", "business_name", "type_of_contract", "date_signed", "start_term", "end_term", "current"],
    filters: {
      current: { label: "Lease", type: "select", options: "leaseCurrent", sql: "l.is_current = @v" },
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "ltoc.id = @v" },
      signed_from: { label: "Signed from", type: "date", sql: "l.date_signed >= @v" },
      signed_to: { label: "Signed to", type: "date", sql: "l.date_signed <= @v" },
    },
  },
};

/** Options of the select filters (loaded with the catalog). */
async function optionLists() {
  const [contractTypes, accountOfficers, nationalities] = await Promise.all([
    selectData(`SELECT id, name FROM dbo.type_of_contract WHERE is_active = 1 ORDER BY name`).catch(() => []),
    selectData(
      `SELECT DISTINCT u.id, ${personName("u")} AS full_name FROM dbo.users u INNER JOIN dbo.proponents p ON p.account_officer_id = u.id ORDER BY 2`
    ).catch(() => []),
    selectData(
      `SELECT DISTINCT UPPER(LTRIM(RTRIM(n))) AS n FROM (
         SELECT nationality AS n FROM dbo.proponents UNION ALL SELECT nationality FROM dbo.stockholder WHERE is_active = 1
       ) x WHERE LTRIM(RTRIM(ISNULL(n, ''))) <> '' ORDER BY 1`
    ).catch(() => []),
  ]);
  return {
    contractTypes: contractTypes.map((r) => ({ value: String(r.id), label: r.name })),
    accountOfficers: accountOfficers.map((r) => ({ value: String(r.id), label: r.full_name })),
    nationalities: nationalities.map((r) => ({ value: r.n, label: r.n })),
    activeStatus: [
      { value: "1", label: "Active" },
      { value: "0", label: "Inactive" },
    ],
    leaseStatuses: ["Active", "Expiring soon", "Expired", "Renewal in process", "No lease term"].map((v) => ({
      value: v,
      label: v === "Expiring soon" ? `Expiring soon (${EXPIRING_DAYS} days)` : v,
    })),
    expiresWithin: [30, 60, 90, 180, 365].map((n) => ({ value: String(n), label: n === 365 ? "1 year" : `${n} days` })),
    tracks: [
      { value: "0", label: "New" },
      { value: "1", label: "Renewal" },
    ],
    applicationStatuses: ["SUBMITTED", "RESUBMITTED", "RETURNED", "FOR_APPROVAL", "APPROVED", "DISAPPROVED", "REJECTED"].map((v) => ({
      value: v,
      label: v.replace(/_/g, " "),
    })),
    leaseCurrent: [
      { value: "1", label: "Current" },
      { value: "0", label: "Earlier" },
    ],
  };
}

/** The catalog the page builds its controls from. */
async function catalog() {
  const options = await optionLists();
  return Object.entries(DATASETS).map(([key, d]) => ({
    key,
    label: d.label,
    description: d.description,
    columns: Object.entries(d.columns).map(([k, c]) => ({ key: k, label: c.label, type: c.type || "text" })),
    defaults: d.defaults,
    filters: [
      ...Object.entries(d.filters).map(([k, f]) => ({ key: k, label: f.label, type: f.type, options: f.options ? options[f.options] || [] : undefined })),
      // Rows where the chosen column is empty — for finding records to complete.
      {
        key: MISSING_FILTER,
        label: "Missing data in",
        type: "select",
        options: Object.entries(d.columns)
          .filter(([, c]) => c.type !== "number" && !c.noMissing)
          .map(([k, c]) => ({ value: k, label: c.label })),
      },
    ],
  }));
}

/** True when the column's value is null or only spaces. */
const blankSql = (expr) => `NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), ${expr}))), '') IS NULL`;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Runs a report. `columns`: keys from the dataset (in order); `filters`:
 * { key: value }; `sort`: { key, dir }. `ownOfficerId`: a Level 2 Account
 * Officer — only their locators. Returns { columns, rows, total, truncated }.
 */
async function run({ dataset, columns, filters = {}, sort = null, ownOfficerId = null, limit = MAX_ROWS }) {
  const d = DATASETS[dataset];
  if (!d) throw badRequest("Choose what to report on.");
  const keys = (Array.isArray(columns) ? columns : []).filter((k) => d.columns[k]);
  if (!keys.length) throw badRequest("Choose at least one column.");

  const params = [];
  const param = (value) => {
    params.push(value);
    return `@param${params.length - 1}`;
  };
  const where = [...d.where];
  let missingClause = null;
  for (const [key, raw] of Object.entries(filters || {})) {
    const value = String(raw ?? "").trim();
    if (key === MISSING_FILTER) {
      const c = value && d.columns[value];
      if (!c || c.type === "number" || c.noMissing) continue;
      missingClause = blankSql(c.sql);
      continue;
    }
    const f = d.filters[key];
    if (!f || !value) continue;
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${f.label}: not a date.`);
    where.push(f.sql.replace("@v", param(f.type === "date" ? value : value.slice(0, 200))));
  }
  if (ownOfficerId) where.push(`p.account_officer_id = ${param(Number(ownOfficerId))}`);

  // "Missing data in" offers only the columns that actually have blanks among
  // these rows (the other filters applied, not the Missing one), with counts.
  const missingKeys = Object.entries(d.columns)
    .filter(([, c]) => c.type !== "number" && !c.noMissing)
    .map(([k]) => k);
  let missing = {};
  if (missingKeys.length) {
    const agg = missingKeys.map((k, i) => `SUM(CASE WHEN ${blankSql(d.columns[k].sql)} THEN 1 ELSE 0 END) AS m${i}`).join(", ");
    const [counts] = await selectData(`SELECT ${agg} ${d.from} WHERE ${where.join(" AND ")}`, params);
    missing = Object.fromEntries(missingKeys.map((k, i) => [k, Number(counts?.[`m${i}`]) || 0]).filter(([, n]) => n > 0));
  }
  if (missingClause) where.push(missingClause);

  const select = keys.map((k, i) => `${d.columns[k].sql} AS c${i}`).join(", ");
  const sortKey = sort?.key && d.columns[sort.key] ? sort.key : null;
  const order = sortKey ? `${d.columns[sortKey].sql} ${sort.dir === "desc" ? "DESC" : "ASC"}` : d.order;
  const cap = Math.min(Math.max(1, Number(limit) || MAX_ROWS), MAX_ROWS);

  const sql = `SELECT TOP (${cap + 1}) ${select} ${d.from} WHERE ${where.join(" AND ")} ORDER BY ${order}`;
  const raw = await selectData(sql, params);
  const truncated = raw.length > cap;
  const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
  const rows = raw.slice(0, cap).map((r) =>
    keys.map((k, i) => {
      const c = d.columns[k];
      let v = r[`c${i}`];
      if (v == null) return null;
      if (c.decrypt) v = decryptValue(v);
      if (c.type === "date") return ymd(v);
      if (c.type === "number") {
        const n = Number(String(v).replace(/,/g, ""));
        return Number.isFinite(n) ? n : String(v);
      }
      return String(v);
    })
  );
  return {
    columns: keys.map((k) => ({ key: k, label: d.columns[k].label, type: d.columns[k].type || "text" })),
    rows,
    total: rows.length,
    truncated,
    missing,
  };
}

/* ------------------------------ Quick total ------------------------------ */
// "Total ___ by ___ as of / in [year]" — e.g. total investments by stockholder
// nationality as of 2025. Covers the Registered Locators dataset (its filters
// apply too). Measures are summed per group in JS: the investment and
// employee figures are free text ("7,145,000.00", "USD 2.5M").

const QT_MEASURES = {
  locators: { label: "Locators" },
  investment: { label: "Investment", money: true },
  employees: { label: "Employees" },
  area: { label: "Leased Area (sqm)" },
};
const QT_BY = {
  nationality: { label: "Stockholder Nationality" },
  industry: { label: "Industry", sql: "ind.name" },
  type_of_contract: { label: "Type of Contract", sql: "toc.name" },
  account_officer: { label: "Account Officer", sql: personName("ao") },
  lease_status: { label: "Lease Status", sql: LEASE_STATUS_SQL },
  land_use: { label: "Land Use", sql: "lu.name" },
  locator_type: { label: "Direct / Sub-lease", sql: "CASE WHEN p.sublessor_id IS NULL THEN 'Direct lease' ELSE 'Sub-lease' END" },
};

function quickTotalOptions() {
  return {
    measures: Object.entries(QT_MEASURES).map(([value, m]) => ({ value, label: m.label })),
    by: Object.entries(QT_BY).map(([value, b]) => ({ value, label: b.label })),
  };
}

/**
 * period "asof": locators with a lease in effect on Dec 31 of the year (today
 * for the current year) — any lease in their history, the current one with its
 * extension. period "in": a lease signed during the year (new or renewal).
 */
async function quickTotal({ measure, by, period = "asof", year, filters = {}, ownOfficerId = null }) {
  const { parseMoney, parseAmount, USD_TEXT } = require("./Report");
  const m = QT_MEASURES[measure];
  const b = QT_BY[by];
  if (!m) throw badRequest("Choose what to total.");
  if (!b) throw badRequest("Choose what to group by.");
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1990 || y > 2100) throw badRequest("Pick a year.");
  const d = DATASETS.locators;

  const params = [];
  const param = (value) => {
    params.push(value);
    return `@param${params.length - 1}`;
  };
  const where = [...d.where];
  for (const [key, raw] of Object.entries(filters || {})) {
    const value = String(raw ?? "").trim();
    const f = d.filters[key];
    if (!f || !value) continue;
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${f.label}: not a date.`);
    where.push(f.sql.replace("@v", param(f.type === "date" ? value : value.slice(0, 200))));
  }
  if (ownOfficerId) where.push(`p.account_officer_id = ${param(Number(ownOfficerId))}`);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const yearEnd = `${y}-12-31`;
  const asOf = yearEnd < today ? yearEnd : today;
  if (period === "in") {
    const from = param(`${y}-01-01`);
    const to = param(yearEnd);
    where.push(`(EXISTS (SELECT 1 FROM dbo.proponent_leases l WHERE l.proponent_id = p.id AND l.is_active = 1
                  AND CAST(l.date_signed AS DATE) BETWEEN ${from} AND ${to})
             OR (NOT EXISTS (SELECT 1 FROM dbo.proponent_leases l WHERE l.proponent_id = p.id AND l.is_active = 1)
                  AND CAST(p.date_signed AS DATE) BETWEEN ${from} AND ${to}))`);
  } else {
    const at = param(asOf);
    where.push(`(EXISTS (SELECT 1 FROM dbo.proponent_leases l WHERE l.proponent_id = p.id AND l.is_active = 1
                  AND CAST(l.start_term AS DATE) <= ${at}
                  AND (CAST(l.end_term AS DATE) >= ${at} OR (l.is_current = 1 AND le.eff_end >= ${at})))
             OR (NOT EXISTS (SELECT 1 FROM dbo.proponent_leases l WHERE l.proponent_id = p.id AND l.is_active = 1)
                  AND CAST(COALESCE(ct.effective_start, p.manual_start_term) AS DATE) <= ${at} AND le.eff_end >= ${at}))`);
  }

  const groupSql = b.sql ? `${b.sql} AS grp` : "CAST(NULL AS NVARCHAR(10)) AS grp";
  const locators = await selectData(
    `SELECT p.id, ${groupSql},
       ${invSql("INVESTMENT", "commitment")} AS inv_c, ${invSql("INVESTMENT", "actual")} AS inv_a,
       ${invSql("EMPLOYEE_COUNT", "commitment")} AS emp_c, ${invSql("EMPLOYEE_COUNT", "actual")} AS emp_a
     ${d.from} WHERE ${where.join(" AND ")}`,
    params
  );
  const ids = locators.map((r) => Number(r.id)).filter(Boolean);

  // Leased area: the current lease's schedule (the Summary report's rule).
  const area = new Map();
  if (measure === "area" && ids.length) {
    const rows = await selectData(
      `SELECT pp.proponent_id, pp.area_sqm FROM dbo.proponent_properties pp
       WHERE pp.is_active = 1 AND pp.proponent_id IN (${ids.join(",")})
         AND (pp.lease_id IS NULL OR pp.lease_id IN (SELECT l.id FROM dbo.proponent_leases l WHERE l.is_current = 1 AND l.is_active = 1))`
    );
    for (const r of rows) {
      const a = parseAmount(r.area_sqm);
      if (a !== null) area.set(r.proponent_id, (area.get(r.proponent_id) || 0) + a);
    }
  }

  // Stockholder nationality: each locator's shares by nationality (ownership %,
  // else subscribed shares, else split evenly).
  const shares = new Map();
  if (by === "nationality" && ids.length) {
    const rows = await selectData(
      `SELECT proponent_id, UPPER(LTRIM(RTRIM(nationality))) AS nat, ownership, subscribed
       FROM dbo.stockholder WHERE is_active = 1 AND proponent_id IN (${ids.join(",")})`
    );
    const per = new Map();
    for (const r of rows) {
      const list = per.get(r.proponent_id) || [];
      list.push({ nat: r.nat || "", own: Number(r.ownership) || 0, sub: Number(r.subscribed) || 0 });
      per.set(r.proponent_id, list);
    }
    for (const [pid, list] of per) {
      const ownSum = list.reduce((n, x) => n + x.own, 0);
      const subSum = list.reduce((n, x) => n + x.sub, 0);
      const w = new Map();
      for (const x of list) {
        const weight = ownSum > 0 ? x.own / ownSum : subSum > 0 ? x.sub / subSum : 1 / list.length;
        const k = x.nat || "Not specified";
        w.set(k, (w.get(k) || 0) + weight);
      }
      shares.set(pid, [...w.entries()].filter(([, v]) => v > 0));
    }
  }

  // What a locator adds: [field, value] pairs — investment per type and
  // currency ("Committed PHP"), employees per type.
  const figuresOf = (r) => {
    const out = [];
    if (measure === "investment") {
      for (const [type, text] of [["Committed", r.inv_c], ["Actual", r.inv_a]]) {
        const amount = parseMoney(text);
        if (amount) out.push([`${type} ${USD_TEXT.test(String(text || "")) ? "USD" : "PHP"}`, amount]);
      }
    } else if (measure === "employees") {
      for (const [type, text] of [["Committed", r.emp_c], ["Actual", r.emp_a]]) {
        const n = parseAmount(text);
        if (n) out.push([type, n]);
      }
    } else if (measure === "area" && area.get(r.id)) out.push(["value", area.get(r.id)]);
    return out;
  };

  const groups = new Map();
  const add = (label, field, value) => {
    const k = label || "Not specified";
    const g = groups.get(k) || { label: k, locators: 0, values: {} };
    if (field === "locators") g.locators += value;
    else g.values[field] = (g.values[field] || 0) + value;
    groups.set(k, g);
  };
  for (const r of locators) {
    const figures = figuresOf(r);
    const split = by === "nationality" ? shares.get(r.id) || [["Not specified", 1]] : [[r.grp ? String(r.grp) : null, 1]];
    // A locator counts once — under its largest nationality; the amounts are split.
    const main = split.reduce((a, x) => (x[1] > a[1] ? x : a), split[0]);
    add(main[0], "locators", 1);
    for (const [field, value] of figures) for (const [label, weight] of split) add(label, field, value * weight);
  }

  const fields =
    measure === "investment" ? ["Committed PHP", "Actual PHP", "Committed USD", "Actual USD"]
    : measure === "employees" ? ["Committed", "Actual"]
    : measure === "area" ? ["value"] : [];
  // Committed / Actual always show (even at zero); a USD pair only when used.
  const used = fields.filter((f) => !/USD/.test(f) || [...groups.values()].some((g) => g.values[f] || g.values[f.replace(/^Committed/, "Actual")] || g.values[f.replace(/^Actual/, "Committed")]));
  const valueOf = (g) => (measure === "locators" ? g.locators : g.values[used[0]] || 0);
  const list = [...groups.values()].sort((a, b) => valueOf(b) - valueOf(a) || b.locators - a.locators || a.label.localeCompare(b.label));
  const round = (n) => Math.round(n * 100) / 100;
  const totals = { locators: locators.length, values: Object.fromEntries(used.map((f) => [f, round(list.reduce((n, g) => n + (g.values[f] || 0), 0))])) };
  return {
    measure: { key: measure, label: m.label },
    by: { key: by, label: b.label },
    period: period === "in" ? "in" : "asof",
    year: y,
    as_of: period === "in" ? null : asOf,
    fields: used,
    groups: list.map((g) => ({ label: g.label, locators: g.locators, values: Object.fromEntries(used.map((f) => [f, round(g.values[f] || 0)])) })),
    totals,
    // Locators in the period that have no figure for the measure.
    without_value: measure === "locators" ? 0 : locators.filter((r) => !figuresOf(r).length).length,
    // Per type: locators with no figure (e.g. 60 have no Actual investment).
    without: Object.fromEntries(
      (measure === "investment" ? [["Committed", "inv_c"], ["Actual", "inv_a"]] : measure === "employees" ? [["Committed", "emp_c"], ["Actual", "emp_a"]] : [])
        .map(([type, col]) => [type, locators.filter((r) => !(measure === "investment" ? parseMoney(r[col]) : parseAmount(r[col]))).length])
    ),
  };
}

/* --------------------------- saved templates --------------------------- */

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.report_templates', 'U') IS NULL
      CREATE TABLE dbo.report_templates (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        name NVARCHAR(120) NOT NULL,
        dataset NVARCHAR(40) NOT NULL,
        config NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_report_templates_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        CONSTRAINT FK_report_templates_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
      );
      -- Shared: every Reports user can open it (only its owner can change it).
      IF COL_LENGTH('dbo.report_templates', 'is_shared') IS NULL
      ALTER TABLE dbo.report_templates ADD is_shared BIT NOT NULL CONSTRAINT DF_report_templates_is_shared DEFAULT (0);
      -- Recurring every month: emailed (Excel) to every Account Officer at the
      -- start of each month from recur_from to recur_to ('YYYY-MM').
      IF COL_LENGTH('dbo.report_templates', 'is_recurring') IS NULL
      ALTER TABLE dbo.report_templates ADD is_recurring BIT NOT NULL CONSTRAINT DF_report_templates_is_recurring DEFAULT (0);
      IF COL_LENGTH('dbo.report_templates', 'recur_from') IS NULL
      ALTER TABLE dbo.report_templates ADD recur_from CHAR(7) NULL;
      IF COL_LENGTH('dbo.report_templates', 'recur_to') IS NULL
      ALTER TABLE dbo.report_templates ADD recur_to CHAR(7) NULL;
      IF COL_LENGTH('dbo.report_templates', 'last_sent_month') IS NULL
      ALTER TABLE dbo.report_templates ADD last_sent_month CHAR(7) NULL;
      IF COL_LENGTH('dbo.report_templates', 'last_sent_at') IS NULL
      ALTER TABLE dbo.report_templates ADD last_sent_at DATETIME2(3) NULL;
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function parseConfig(text) {
  try {
    const c = JSON.parse(text || "{}");
    return c && typeof c === "object" ? c : {};
  } catch {
    return {};
  }
}

async function listTemplates(userId) {
  await ensureSchema();
  // The user's own templates, then the ones others have shared.
  const rows = await selectData(
    `SELECT t.id, t.name, t.dataset, t.config, t.is_shared, t.created_at, t.updated_at,
        t.is_recurring, t.recur_from, t.recur_to, t.last_sent_month, t.last_sent_at,
        CASE WHEN t.user_id = @param0 THEN 1 ELSE 0 END AS mine, ${personName("u")} AS owner
     FROM dbo.report_templates t
     LEFT JOIN dbo.users u ON u.id = t.user_id
     WHERE t.user_id = @param0 OR t.is_shared = 1
     ORDER BY CASE WHEN t.user_id = @param0 THEN 0 ELSE 1 END, t.name`,
    [Number(userId)]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    dataset: r.dataset,
    config: parseConfig(r.config),
    shared: Boolean(r.is_shared),
    mine: Number(r.mine) === 1,
    owner: r.owner || null,
    updated_at: r.updated_at || r.created_at,
    recurring: Boolean(r.is_recurring),
    recur_from: r.recur_from ? String(r.recur_from).trim() : null,
    recur_to: r.recur_to ? String(r.recur_to).trim() : null,
    last_sent_month: r.last_sent_month ? String(r.last_sent_month).trim() : null,
    last_sent_at: r.last_sent_at || null,
  }));
}

/** Saves (or, same name, replaces) one of the user's templates. `shared`:
 * other Reports users can open it too. */
async function saveTemplate(userId, { name, dataset, columns, filters, sort, shared, recurring, recur_from, recur_to }) {
  await ensureSchema();
  const title = String(name || "").trim().slice(0, 120);
  if (!title) throw badRequest("Name the template.");
  const d = DATASETS[dataset];
  if (!d) throw badRequest("Choose what to report on.");
  const config = JSON.stringify({
    columns: (Array.isArray(columns) ? columns : []).filter((k) => d.columns[k]),
    filters: Object.fromEntries(
      Object.entries(filters || {}).filter(([k, v]) => (d.filters[k] || k === MISSING_FILTER) && String(v ?? "").trim())
    ),
    sort: sort?.key && d.columns[sort.key] ? { key: sort.key, dir: sort.dir === "desc" ? "desc" : "asc" } : null,
  });
  // Recurring every month: from / to months ('YYYY-MM'), from <= to.
  const ym = (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || "")) ? String(v) : null);
  const isRecurring = Boolean(recurring);
  const from = isRecurring ? ym(recur_from) : null;
  const to = isRecurring ? ym(recur_to) : null;
  if (isRecurring && (!from || !to)) throw badRequest("Pick the months the report goes out (from and to).");
  if (isRecurring && from > to) throw badRequest("The 'from' month is after the 'to' month.");
  const existing = await selectData(`SELECT id FROM dbo.report_templates WHERE user_id = @param0 AND name = @param1`, [Number(userId), title]);
  if (existing[0]) {
    await updateData(
      `UPDATE dbo.report_templates SET dataset = @param1, config = @param2, is_shared = @param3,
         is_recurring = @param4, recur_from = @param5, recur_to = @param6, updated_at = SYSUTCDATETIME() WHERE id = @param0`,
      [existing[0].id, dataset, config, shared ? 1 : 0, isRecurring ? 1 : 0, from, to]
    );
    return existing[0].id;
  }
  const result = await insertData(
    `INSERT INTO dbo.report_templates (user_id, name, dataset, config, is_shared, is_recurring, recur_from, recur_to)
     OUTPUT inserted.id VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7)`,
    [Number(userId), title, dataset, config, shared ? 1 : 0, isRecurring ? 1 : 0, from, to]
  );
  return result?.recordset?.[0]?.id ?? null;
}

async function deleteTemplate(userId, id) {
  await ensureSchema();
  const result = await updateData(`DELETE FROM dbo.report_templates WHERE id = @param0 AND user_id = @param1`, [Number(id), Number(userId)]);
  return Boolean(result?.rowsAffected?.[0]);
}

/** One template with its config (for the monthly send). */
async function getTemplate(id) {
  await ensureSchema();
  const [r] = await selectData(
    `SELECT t.*, ${personName("u")} AS owner FROM dbo.report_templates t LEFT JOIN dbo.users u ON u.id = t.user_id WHERE t.id = @param0`,
    [Number(id)]
  );
  return r ? { ...r, config: parseConfig(r.config) } : null;
}

/** Recurring templates whose month range covers `month` ('YYYY-MM') and that
 * haven't gone out for it yet. */
async function listDueRecurring(month) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT id FROM dbo.report_templates
     WHERE is_recurring = 1 AND recur_from <= @param0 AND recur_to >= @param0
       AND (last_sent_month IS NULL OR last_sent_month <> @param0)`,
    [month]
  );
  return rows.map((r) => r.id);
}

async function markSent(id, month) {
  await updateData(`UPDATE dbo.report_templates SET last_sent_month = @param1, last_sent_at = SYSUTCDATETIME() WHERE id = @param0`, [
    Number(id),
    month,
  ]);
}

/** A run result as an Excel workbook (Buffer): title, subtitle, header row,
 * rows, and a TOTAL row for the number columns. */
async function buildWorkbook(result, { title, subtitle, sheetName = "Report" }) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report");
  const n = Math.max(1, result.columns.length);
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(1, 1, 1, n);
  ws.mergeCells(2, 1, 2, n);
  ws.addRow([]);
  const head = ws.addRow(result.columns.map((c) => c.label));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  const toDate = (v) => (v ? new Date(`${v}T00:00:00Z`) : null);
  for (const r of result.rows) {
    ws.addRow(r.map((v, i) => (result.columns[i].type === "date" ? toDate(v) : v)));
  }
  const summable = (c) => c.type === "number" && !/%/.test(c.label) && !/days left/i.test(c.label);
  if (result.columns.some(summable) && result.rows.length) {
    const total = ws.addRow(
      result.columns.map((c, i) =>
        summable(c) ? result.rows.reduce((s, r) => s + (typeof r[i] === "number" ? r[i] : 0), 0) : i === 0 ? "TOTAL" : null
      )
    );
    total.font = { bold: true };
  }
  result.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.type === "date" || c.type === "number" ? 16 : Math.min(45, Math.max(14, c.label.length + 4));
    if (c.type === "date") col.numFmt = "mmm d, yyyy";
    if (c.type === "number") col.numFmt = "#,##0.##";
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { DATASETS, MAX_ROWS, catalog, run, quickTotal, quickTotalOptions, getTemplate, listDueRecurring, markSent, buildWorkbook, ensureSchema, listTemplates, saveTemplate, deleteTemplate };
