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

/** Advance Lease Payment / Security Deposit / Performance Security (dbo.proponent_financial_terms). */
const termSql = (type, field) =>
  `(SELECT TOP (1) NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(50), ft.${field}))), '') FROM dbo.proponent_financial_terms ft WHERE ft.proponent_id = p.id AND ft.term_type = '${type}' AND ft.is_active = 1)`;
/** Development Timeline milestone date (dbo.proponent_development_milestones). */
const milestoneSql = (code) =>
  `(SELECT TOP (1) m.milestone_date FROM dbo.proponent_development_milestones m WHERE m.proponent_id = p.id AND m.milestone_code = '${code}')`;
/** The current lease's billing basis (4-04): Monthly / Yearly. */
const BASIS_SQL = `(SELECT TOP (1) CASE WHEN UPPER(cl.rate_period) = 'YEAR' THEN 'Yearly' ELSE 'Monthly' END
  FROM dbo.proponent_leases cl WHERE cl.proponent_id = p.id AND cl.is_current = 1 AND cl.is_active = 1 ORDER BY cl.id DESC)`;
/** SEC or DTI (blank = SEC). */
const REG_TYPE_SQL = "CASE WHEN UPPER(p.registration_type) = 'DTI' THEN 'DTI' ELSE 'SEC' END";
/** A free-text amount as a number (commas dropped), NULL when not one. */
const amountSql = (expr) => `TRY_CONVERT(DECIMAL(19, 2), REPLACE(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(100), ${expr}))), ''), ',', ''))`;
/** The current lease's Property Schedule rows (legacy rows have no lease). */
const CURRENT_PROPS = `dbo.proponent_properties cpp WHERE cpp.proponent_id = p.id AND cpp.is_active = 1
  AND (cpp.lease_id IS NULL OR cpp.lease_id IN (SELECT x.id FROM dbo.proponent_leases x WHERE x.is_current = 1 AND x.is_active = 1))`;

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
      registration_type: { label: "Registered with (SEC/DTI)", sql: REG_TYPE_SQL, noMissing: true },
      registration_no: { label: "SEC/DTI Reg. No.", sql: "p.registration_no" },
      authorized_capital: { label: "Authorized Capital", sql: amountSql("p.authorized_capital"), type: "number" },
      subscribed_capital: { label: "Subscribed Capital", sql: amountSql("p.subscribed_capital"), type: "number" },
      paid_up_capital: { label: "Paid-up Capital", sql: amountSql("p.paid_up_capital"), type: "number" },
      capital_currency: { label: "Capital Currency", sql: "COALESCE(NULLIF(p.authorized_capital_currency, ''), NULLIF(p.subscribed_capital_currency, ''))" },
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
      // Property Schedule (current lease).
      billing_basis: { label: "Billing Basis", sql: BASIS_SQL },
      // One per property (Type of Property + Area): an escalated property has a row per period.
      leased_area: {
        label: "Leased Area (sqm)",
        sql: `(SELECT SUM(d.a) FROM (SELECT DISTINCT UPPER(LTRIM(RTRIM(cpp.type_of_property))) AS t, ${amountSql("cpp.area_sqm")} AS a FROM ${CURRENT_PROPS}) d)`,
        type: "number",
      },
      property_types: {
        label: "Type of Property",
        sql: `STUFF((SELECT DISTINCT ', ' + UPPER(LTRIM(RTRIM(cpp.type_of_property))) FROM ${CURRENT_PROPS} AND NULLIF(LTRIM(cpp.type_of_property), '') IS NOT NULL FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '')`,
      },
      // Financial terms.
      advance_months: { label: "Advance Lease Payment – Months", sql: termSql("ADVANCE_LEASE_PAYMENT", "months"), type: "number" },
      advance_amount: { label: "Advance Lease Payment – Amount", sql: termSql("ADVANCE_LEASE_PAYMENT", "amount"), type: "number" },
      advance_total: { label: "Advance Lease Payment – Total", sql: termSql("ADVANCE_LEASE_PAYMENT", "total_amount"), type: "number" },
      deposit_months: { label: "Security Deposit – Months", sql: termSql("SECURITY_DEPOSIT", "months"), type: "number" },
      deposit_amount: { label: "Security Deposit – Amount", sql: termSql("SECURITY_DEPOSIT", "amount"), type: "number" },
      deposit_total: { label: "Security Deposit – Total", sql: termSql("SECURITY_DEPOSIT", "total_amount"), type: "number" },
      performance_months: { label: "Performance Security – Months", sql: termSql("PERFORMANCE_SECURITY", "months"), type: "number" },
      performance_amount: { label: "Performance Security – Amount", sql: termSql("PERFORMANCE_SECURITY", "amount"), type: "number" },
      performance_total: { label: "Performance Security – Total", sql: termSql("PERFORMANCE_SECURITY", "total_amount"), type: "number" },
      // Development Timeline (4-11).
      milestone_plans: { label: "Submission of Construction Plans", sql: milestoneSql("A"), type: "date" },
      milestone_start: { label: "Start of Construction", sql: milestoneSql("B"), type: "date" },
      milestone_done: { label: "Completion of Construction", sql: milestoneSql("C"), type: "date" },
      milestone_operation: { label: "Start of Operation", sql: milestoneSql("D"), type: "date" },
    },
    defaults: ["ref_code", "business_name", "nationality", "type_of_contract", "account_officer", "start_term", "end_term", "lease_status"],
    filters: {
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
      lease_status: { label: "Lease Status", type: "select", options: "leaseStatuses", sql: `${LEASE_STATUS_SQL} = @v` },
      end_from: { label: "End Term from", type: "date", sql: "CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE) >= @v" },
      end_to: { label: "End Term to", type: "date", sql: "CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE) <= @v" },
      expires_within: {
        label: "Expires within",
        type: "select",
        options: "expiresWithin",
        sql: "le.eff_end >= CAST(GETDATE() AS DATE) AND le.eff_end <= DATEADD(day, TRY_CAST(@v AS INT), CAST(GETDATE() AS DATE))",
      },
      status: { label: "Record Status", type: "select", options: "activeStatus", sql: "p.is_active = @v" },
      nationality: { label: "Nationality", type: "select", options: "nationalities", sql: "UPPER(LTRIM(RTRIM(p.nationality))) = @v" },
      registration_type: { label: "Registered with", type: "select", options: "registrationTypes", sql: `${REG_TYPE_SQL} = @v` },
      billing_basis: { label: "Billing Basis", type: "select", options: "billingBases", sql: `${BASIS_SQL} = @v` },
      property_type: {
        label: "Type of Property",
        type: "select",
        options: "propertyTypes",
        sql: `EXISTS (SELECT 1 FROM ${CURRENT_PROPS} AND UPPER(LTRIM(RTRIM(cpp.type_of_property))) = @v)`,
      },
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
      registration_type: { label: "Registered with (SEC/DTI)", sql: REG_TYPE_SQL, noMissing: true },
      subscribed_capital: { label: "Subscribed Capital", sql: amountSql("p.subscribed_capital"), type: "number" },
      paid_up_capital: { label: "Paid-up Capital", sql: amountSql("p.paid_up_capital"), type: "number" },
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
      billing_basis: { label: "Billing Basis", sql: "CASE WHEN UPPER(l.rate_period) = 'YEAR' THEN 'Yearly' ELSE 'Monthly' END", noMissing: true },
      extensions: {
        label: "Extensions",
        sql: "(SELECT COUNT(*) FROM dbo.proponent_extensions e WHERE e.lease_id = l.id AND e.is_active = 1)",
        type: "number",
      },
      latest_extension: {
        label: "Latest Extension Date",
        sql: "(SELECT MAX(e.extension_date) FROM dbo.proponent_extensions e WHERE e.lease_id = l.id AND e.is_active = 1)",
        type: "date",
      },
    },
    defaults: ["lease_ref_code", "business_name", "type_of_contract", "date_signed", "start_term", "end_term", "current"],
    filters: {
      current: { label: "Lease", type: "select", options: "leaseCurrent", sql: "l.is_current = @v" },
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "ltoc.id = @v" },
      signed_from: { label: "Signed from", type: "date", sql: "l.date_signed >= @v" },
      signed_to: { label: "Signed to", type: "date", sql: "l.date_signed <= @v" },
      billing_basis: {
        label: "Billing Basis",
        type: "select",
        options: "billingBases",
        sql: "(CASE WHEN UPPER(l.rate_period) = 'YEAR' THEN 'Yearly' ELSE 'Monthly' END) = @v",
      },
    },
  },

  properties: {
    label: "Property Schedule",
    description: "One row per Property Schedule period — escalated rows included.",
    from: `FROM dbo.proponent_properties pp
      INNER JOIN dbo.proponents p ON p.id = pp.proponent_id
      LEFT JOIN dbo.proponent_leases pl ON pl.id = pp.lease_id
      ${CONTRACT_TYPE_APPLY}`,
    where: ["pp.is_active = 1", REGISTERED],
    order: "p.business_name, CASE WHEN pp.lease_id IS NULL OR pl.is_current = 1 THEN 0 ELSE 1 END, pp.date_from, pp.sort_order, pp.id",
    columns: {
      ...LOCATOR_COLUMNS,
      lease_ref_code: { label: "Lease Ref. Code", sql: "COALESCE(pl.ref_code, p.ref_code)" },
      lease: { label: "Lease", sql: "CASE WHEN pp.lease_id IS NULL OR pl.is_current = 1 THEN 'Current' ELSE 'Earlier' END", noMissing: true },
      billing_basis: {
        label: "Billing Basis",
        // The row's own lease; a legacy row (no lease) follows the current one.
        sql: `CASE WHEN UPPER(COALESCE(pl.rate_period, (SELECT TOP (1) cl.rate_period FROM dbo.proponent_leases cl
                 WHERE cl.proponent_id = p.id AND cl.is_current = 1 AND cl.is_active = 1 ORDER BY cl.id DESC))) = 'YEAR'
               THEN 'Yearly' ELSE 'Monthly' END`,
        noMissing: true,
      },
      year: { label: "Year", sql: "pp.year" },
      date_from: { label: "Date From", sql: "pp.date_from", type: "date" },
      date_to: { label: "Date To", sql: "pp.date_to", type: "date" },
      type_of_property: { label: "Type of Property", sql: "pp.type_of_property" },
      area_sqm: { label: "Area (sqm)", sql: amountSql("pp.area_sqm"), type: "number" },
      rate_type: { label: "Rate Type", sql: "CASE WHEN pp.rate_type = 'NON_STANDARD' THEN 'Non-standard' ELSE 'Standard' END", noMissing: true },
      rate_sqm: { label: "Rate/SQM", sql: amountSql("pp.rate_sqm_mo"), type: "number" },
      rate_currency: { label: "Rate Currency", sql: "pp.rate_currency" },
      mgl: { label: "MGL", sql: amountSql("pp.mgl_mo"), type: "number" },
      mgl_currency: { label: "MGL Currency", sql: "pp.mgl_currency" },
      months: { label: "Months", sql: "CASE WHEN pp.date_from IS NULL OR pp.date_to IS NULL THEN NULL ELSE DATEDIFF(month, pp.date_from, DATEADD(day, 1, pp.date_to)) END", type: "number" },
    },
    defaults: ["lease_ref_code", "business_name", "year", "date_from", "date_to", "type_of_property", "area_sqm", "rate_sqm", "mgl", "mgl_currency"],
    filters: {
      lease: { label: "Lease", type: "select", options: "leaseCurrent", sql: "(CASE WHEN pp.lease_id IS NULL OR pl.is_current = 1 THEN 1 ELSE 0 END) = @v" },
      property_type: { label: "Type of Property", type: "select", options: "propertyTypes", sql: "UPPER(LTRIM(RTRIM(pp.type_of_property))) = @v" },
      rate_type: { label: "Rate Type", type: "select", options: "rateTypes", sql: "(CASE WHEN pp.rate_type = 'NON_STANDARD' THEN 'NON_STANDARD' ELSE 'STANDARD' END) = @v" },
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
      from_from: { label: "Date From from", type: "date", sql: "CAST(pp.date_from AS DATE) >= @v" },
      from_to: { label: "Date From to", type: "date", sql: "CAST(pp.date_from AS DATE) <= @v" },
    },
  },

  investment_years: {
    label: "Performance Commitment by Year",
    description: "One row per lease year — investment and employees, committed vs actual.",
    from: `FROM dbo.proponent_investment_years y
      INNER JOIN dbo.proponents p ON p.id = y.proponent_id
      ${CONTRACT_TYPE_APPLY}
      CROSS APPLY (SELECT CAST(COALESCE(ct.effective_start, p.manual_start_term) AS DATE) AS lease_start) ys`,
    where: [REGISTERED],
    order: "p.business_name, y.year_no",
    columns: {
      ...LOCATOR_COLUMNS,
      year_no: { label: "Lease Year", sql: "CONCAT('Year ', y.year_no)", noMissing: true },
      year_from: { label: "Year From", sql: "DATEADD(year, y.year_no - 1, ys.lease_start)", type: "date" },
      year_to: { label: "Year To", sql: "DATEADD(day, -1, DATEADD(year, y.year_no, ys.lease_start))", type: "date" },
      investment_commitment: { label: "Investment – Committed", sql: amountSql("y.investment_commitment"), type: "number" },
      investment_actual: { label: "Investment – Actual", sql: amountSql("y.investment_actual"), type: "number" },
      employee_commitment: { label: "Employees – Committed", sql: amountSql("y.employee_commitment"), type: "number" },
      employee_actual: { label: "Employees – Actual", sql: amountSql("y.employee_actual"), type: "number" },
    },
    defaults: ["ref_code", "business_name", "year_no", "year_from", "year_to", "investment_commitment", "investment_actual", "employee_commitment", "employee_actual"],
    filters: {
      year_no: { label: "Lease Year", type: "select", options: "leaseYears", sql: "y.year_no = @v" },
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
      nationality: { label: "Nationality", type: "select", options: "nationalities", sql: "UPPER(LTRIM(RTRIM(p.nationality))) = @v" },
    },
  },

  extensions: {
    label: "Extension Dates",
    description: "One row per Extension Date — the full history of every lease.",
    from: `FROM dbo.proponent_extensions e
      INNER JOIN dbo.proponents p ON p.id = e.proponent_id
      LEFT JOIN dbo.proponent_leases el ON el.id = e.lease_id
      LEFT JOIN dbo.users eby ON eby.id = e.created_by
      ${CONTRACT_TYPE_APPLY}`,
    where: ["e.is_active = 1", REGISTERED],
    order: "p.business_name, e.extension_date DESC, e.id DESC",
    columns: {
      ...LOCATOR_COLUMNS,
      lease_ref_code: { label: "Lease Ref. Code", sql: "el.ref_code" },
      lease: { label: "Lease", sql: "CASE WHEN el.is_current = 1 THEN 'Current' WHEN el.id IS NULL THEN NULL ELSE 'Earlier' END" },
      end_term: { label: "End Term", sql: "el.end_term", type: "date" },
      extension_date: { label: "Extension Date", sql: "e.extension_date", type: "date" },
      remarks: { label: "Remarks", sql: "e.remarks" },
      encoded_by: { label: "Encoded By", sql: personName("eby") },
      encoded_on: { label: "Date Encoded", sql: "e.created_at", type: "date" },
    },
    defaults: ["ref_code", "business_name", "lease_ref_code", "end_term", "extension_date", "remarks", "encoded_by", "encoded_on"],
    filters: {
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
      ext_from: { label: "Extension Date from", type: "date", sql: "CAST(e.extension_date AS DATE) >= @v" },
      ext_to: { label: "Extension Date to", type: "date", sql: "CAST(e.extension_date AS DATE) <= @v" },
    },
  },
};

/** Options of the select filters (loaded with the catalog). */
async function optionLists() {
  const [contractTypes, accountOfficers, nationalities, propertyTypes, maxYear] = await Promise.all([
    selectData(`SELECT id, name FROM dbo.type_of_contract WHERE is_active = 1 ORDER BY name`).catch(() => []),
    selectData(
      `SELECT DISTINCT u.id, ${personName("u")} AS full_name FROM dbo.users u INNER JOIN dbo.proponents p ON p.account_officer_id = u.id ORDER BY 2`
    ).catch(() => []),
    selectData(
      `SELECT DISTINCT UPPER(LTRIM(RTRIM(n))) AS n FROM (
         SELECT nationality AS n FROM dbo.proponents UNION ALL SELECT nationality FROM dbo.stockholder WHERE is_active = 1
       ) x WHERE LTRIM(RTRIM(ISNULL(n, ''))) <> '' ORDER BY 1`
    ).catch(() => []),
    // File Maintenance types plus any older value on a schedule row.
    selectData(
      `SELECT DISTINCT UPPER(LTRIM(RTRIM(n))) AS n FROM (
         SELECT name AS n FROM dbo.property_type WHERE is_active = 1
         UNION ALL SELECT type_of_property FROM dbo.proponent_properties WHERE is_active = 1
       ) x WHERE LTRIM(RTRIM(ISNULL(n, ''))) <> '' ORDER BY 1`
    ).catch(() => []),
    selectData(`SELECT MAX(year_no) AS n FROM dbo.proponent_investment_years`).catch(() => []),
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
    registrationTypes: [
      { value: "SEC", label: "SEC" },
      { value: "DTI", label: "DTI" },
    ],
    billingBases: [
      { value: "Monthly", label: "Monthly" },
      { value: "Yearly", label: "Yearly" },
    ],
    rateTypes: [
      { value: "STANDARD", label: "Standard" },
      { value: "NON_STANDARD", label: "Non-standard" },
    ],
    propertyTypes: propertyTypes.map((r) => ({ value: r.n, label: r.n })),
    leaseYears: Array.from({ length: Math.max(1, Number(maxYear?.[0]?.n) || 1) }, (_, k) => ({ value: String(k + 1), label: `Year ${k + 1}` })),
    leaseCurrent: [
      { value: "1", label: "Current" },
      { value: "0", label: "Earlier" },
    ],
  };
}

/** The heading a column is listed under on the page (Columns → Add a column). */
const COLUMN_GROUPS = [
  ["Locator", /^(ref_code|ref_no|business_name|nationality|type_of_contract|industry|account_officer|tin|address|lease_address|location|land_use|contact_no|business_activities|sublessor|status|created_at|application_no|track|stage|evaluator|submitted_at)$/],
  ["Registration & Capital", /^(registration_type|registration_no|authorized_capital|subscribed_capital|paid_up_capital|capital_currency)$/],
  ["Stockholder", /^(stockholder|stockholder_nationality|subscribed|paid|ownership)$/],
  ["Financial Terms", /^(advance|deposit|performance)_/],
  ["Performance Commitment", /^(investment|employees?)_|^year_(no|from|to)$/],
  ["Development Timeline", /^milestone_/],
  ["Property Schedule", /^(leased_area|property_types|year|date_from|date_to|type_of_property|area_sqm|rate_type|rate_sqm|rate_currency|mgl|mgl_currency|months)$/],
  ["Extension", /^(extension_date|extensions|latest_extension|remarks|encoded_by|encoded_on)$/],
];
const columnGroup = (key) => COLUMN_GROUPS.find(([, re]) => re.test(key))?.[0] || "Lease";

/** The catalog the page builds its controls from. */
async function catalog() {
  const options = await optionLists();
  return Object.entries(DATASETS).map(([key, d]) => ({
    key,
    label: d.label,
    description: d.description,
    columns: Object.entries(d.columns).map(([k, c]) => ({ key: k, label: c.label, type: c.type || "text", group: columnGroup(k) })),
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
    // Flags per row first, summed outside: SQL Server can't SUM over a
    // column that is itself a subquery (Billing Basis, milestones, …).
    const flags = missingKeys.map((k, i) => `CASE WHEN ${blankSql(d.columns[k].sql)} THEN 1 ELSE 0 END AS m${i}`).join(", ");
    const agg = missingKeys.map((k, i) => `SUM(t.m${i}) AS m${i}`).join(", ");
    const [counts] = await selectData(`SELECT ${agg} FROM (SELECT ${flags} ${d.from} WHERE ${where.join(" AND ")}) t`, params);
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
  mgl: { label: "MGL per month" },
};
const QT_BY = {
  nationality: { label: "Stockholder Nationality" },
  industry: { label: "Industry", sql: "ind.name" },
  type_of_contract: { label: "Type of Contract", sql: "toc.name" },
  account_officer: { label: "Account Officer", sql: personName("ao") },
  lease_status: { label: "Lease Status", sql: LEASE_STATUS_SQL },
  land_use: { label: "Land Use", sql: "lu.name" },
  locator_type: { label: "Direct / Sub-lease", sql: "CASE WHEN p.sublessor_id IS NULL THEN 'Direct lease' ELSE 'Sub-lease' END" },
  type_of_property: { label: "Type of Property" },
  registration_type: { label: "Registered with (SEC/DTI)", sql: REG_TYPE_SQL },
  billing_basis: { label: "Billing Basis", sql: BASIS_SQL },
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

  // Property Schedule (current lease): per locator, its properties — one per
  // Type of Property + Area, since an escalated property has a row per period
  // (its area counted once) — and the MGL of the rows in effect on the as-of
  // date (a yearly lease's MGL/YR ÷ 12).
  const props = new Map(); // pid -> { area: Map(type -> sqm), seen: Set, mgl: [{ type, currency, amount }] }
  if ((measure === "area" || measure === "mgl" || by === "type_of_property") && ids.length) {
    const rows = await selectData(
      `SELECT pp.proponent_id, UPPER(LTRIM(RTRIM(pp.type_of_property))) AS type, pp.area_sqm, pp.mgl_mo, pp.mgl_currency,
              CAST(pp.date_from AS DATE) AS date_from, CAST(pp.date_to AS DATE) AS date_to,
              COALESCE(pl.rate_period, cur.rate_period) AS rate_period
       FROM dbo.proponent_properties pp
       LEFT JOIN dbo.proponent_leases pl ON pl.id = pp.lease_id
       OUTER APPLY (SELECT TOP (1) c.rate_period FROM dbo.proponent_leases c
                    WHERE c.proponent_id = pp.proponent_id AND c.is_current = 1 AND c.is_active = 1 ORDER BY c.id DESC) cur
       WHERE pp.is_active = 1 AND pp.proponent_id IN (${ids.join(",")})
         AND (pp.lease_id IS NULL OR pl.is_current = 1)`
    );
    const ymdOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "");
    for (const r of rows) {
      const entry = props.get(r.proponent_id) || { area: new Map(), seen: new Set(), mgl: [] };
      const type = r.type || "Not specified";
      const sqm = parseAmount(r.area_sqm);
      const key = `${type}|${sqm ?? ""}`;
      if (!entry.area.has(type)) entry.area.set(type, 0);
      if (sqm !== null && !entry.seen.has(key)) {
        entry.seen.add(key);
        entry.area.set(type, entry.area.get(type) + sqm);
      }
      const mgl = parseAmount(r.mgl_mo);
      const from = ymdOf(r.date_from);
      const to = ymdOf(r.date_to);
      if (mgl !== null && from && to && from <= asOf && asOf <= to) {
        const monthly = String(r.rate_period || "").toUpperCase() === "YEAR" ? mgl / 12 : mgl;
        entry.mgl.push({ type, currency: String(r.mgl_currency || "PHP").trim().toUpperCase() === "USD" ? "USD" : "PHP", amount: monthly });
      }
      props.set(r.proponent_id, entry);
    }
  }
  const area = new Map([...props].map(([pid, e]) => [pid, [...e.area.values()].reduce((a, b) => a + b, 0)]));

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
    else if (measure === "mgl") for (const m of props.get(r.id)?.mgl || []) out.push([m.currency, m.amount]);
    return out;
  };
  // By Type of Property: each property's own figures go to its type (no
  // weights); the locator counts under its largest type by area. Investment /
  // employees aren't per property: they go under the locator's main type.
  const typedFigures = (r) => {
    const e = props.get(r.id);
    if (measure === "area") return e ? [...e.area].filter(([, sqm]) => sqm).map(([type, sqm]) => [type, "value", sqm]) : [];
    if (measure === "mgl") return e ? e.mgl.map((m) => [m.type, m.currency, m.amount]) : [];
    return figuresOf(r).map(([field, value]) => [null, field, value]);
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
    if (by === "type_of_property") {
      const types = [...(props.get(r.id)?.area || [])];
      const main = types.length ? types.reduce((a, x) => (x[1] > a[1] ? x : a), types[0])[0] : "Not specified";
      add(main, "locators", 1);
      for (const [type, field, value] of typedFigures(r)) add(type || main, field, value);
      continue;
    }
    const split = by === "nationality" ? shares.get(r.id) || [["Not specified", 1]] : [[r.grp ? String(r.grp) : null, 1]];
    // A locator counts once — under its largest nationality; the amounts are split.
    const main = split.reduce((a, x) => (x[1] > a[1] ? x : a), split[0]);
    add(main[0], "locators", 1);
    for (const [field, value] of figures) for (const [label, weight] of split) add(label, field, value * weight);
  }

  const fields =
    measure === "investment" ? ["Committed PHP", "Actual PHP", "Committed USD", "Actual USD"]
    : measure === "employees" ? ["Committed", "Actual"]
    : measure === "area" ? ["value"]
    : measure === "mgl" ? ["PHP", "USD"] : [];
  // Committed / Actual always show (even at zero); a USD pair only when used.
  const used = fields.filter((f) => (measure === "mgl" && f === "PHP") || (measure !== "mgl" && !/USD/.test(f)) || [...groups.values()].some((g) => g.values[f] || g.values[f.replace(/^Committed/, "Actual")] || g.values[f.replace(/^Actual/, "Committed")]));
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
async function saveTemplate(userId, { name, dataset, columns, filters, sort, shared, recurring, recur_from, recur_to, mode, totals }) {
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
    // Opens in Totals with its sentence (Registered Locators only).
    mode: mode === "totals" && dataset === "locators" ? "totals" : "list",
    totals:
      mode === "totals" && dataset === "locators" && totals && QT_MEASURES[totals.measure] && QT_BY[totals.by]
        ? {
            measure: totals.measure,
            by: totals.by,
            period: totals.period === "in" ? "in" : "asof",
            year: /^\d{4}$/.test(String(totals.year || "")) ? String(totals.year) : String(new Date().getFullYear()),
          }
        : null,
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

/** A Totals result as a table (columns + rows) for the Excel workbook:
 * the group, Locators, each figure, and % Share (not summed). */
function totalsAsTable(t) {
  const isCount = t.measure.key === "locators";
  const label = (f) => (f === "value" ? t.measure.label : /^(PHP|USD)$/.test(f) ? `${t.measure.label} (${f})` : f.replace(/^(\w+) (PHP|USD)$/, "$1 ($2)"));
  const first = t.fields[0];
  const share = (g) => {
    const total = isCount || !first ? t.totals.locators : t.totals.values[first];
    const part = isCount || !first ? g.locators : g.values[first] || 0;
    return total ? Math.round((part / total) * 1000) / 10 : 0;
  };
  return {
    columns: [
      { key: "group", label: t.by.label, type: "text" },
      { key: "locators", label: "Locators", type: "number" },
      ...t.fields.map((f) => ({ key: f, label: label(f), type: "number" })),
      { key: "share", label: "% Share", type: "number" },
    ],
    rows: t.groups.map((g) => [g.label, g.locators, ...t.fields.map((f) => g.values[f] || 0), share(g)]),
    total: t.groups.length,
    truncated: false,
  };
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

/** A run result as an Excel workbook (Buffer), laid out exactly like the
 * Custom Report's own Excel download (src/components/reports/reportExports.ts):
 * Arial, title row 3, "AGENCY:" row 5 with the subtitle under it, grey bold
 * header on row 7 (frozen, repeated on print), thin borders, landscape A4,
 * and a highlighted TOTAL row for the number columns. */
async function buildWorkbook(result, { title, subtitle, sheetName = "Report", empty = "No rows match these filters." }) {
  const ExcelJS = require("exceljs");
  const site = require("../lib/siteSettings").getters;
  const FONT = "Arial";
  const HEADER_FILL = "FFD8D8D8";
  const HIGHLIGHT_FILL = "FFFFF2CC";
  const TITLE_ROW = 3;
  const AGENCY_ROW = 5;
  const HEADER_ROW = 7;
  const thin = { style: "thin" };
  const medium = { style: "medium" };

  const wb = new ExcelJS.Workbook();
  wb.creator = site.orgShortName();
  wb.created = new Date();
  const sheet = wb.addWorksheet(String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.24, right: 0.24, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
  });

  // Same column specs as the page's exportExcel().
  const columns = result.columns.map((c) => ({
    header: c.label,
    width: c.type === "date" || c.type === "number" ? 14 : Math.min(45, Math.max(14, c.label.length + 4)),
    align: c.type === "number" ? "right" : "left",
    numFmt: c.type === "date" ? "mmm d, yyyy" : c.type === "number" ? "#,##0.##" : undefined,
  }));
  const lastCol = Math.max(1, columns.length);
  sheet.columns = columns.map((c) => ({ width: c.width }));

  sheet.mergeCells(TITLE_ROW, 1, TITLE_ROW, lastCol);
  const titleCell = sheet.getCell(TITLE_ROW, 1);
  titleCell.value = String(title || "").toUpperCase();
  titleCell.font = { name: FONT, size: 14, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.getRow(TITLE_ROW).height = 22;

  const agency = sheet.getCell(AGENCY_ROW, 1);
  agency.value = `AGENCY: ${String(site.orgName() || site.orgShortName()).toUpperCase()}`;
  agency.font = { name: FONT, size: 12, bold: true };
  if (subtitle) {
    const sub = sheet.getCell(AGENCY_ROW + 1, 1);
    sub.value = subtitle;
    sub.font = { name: FONT, size: 11, bold: true };
  }

  const header = sheet.getRow(HEADER_ROW);
  header.height = 45;
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 11, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: medium, bottom: thin, left: i === 0 ? medium : thin, right: i === lastCol - 1 ? medium : thin };
  });

  // DATE values as date-only Excel values (no time-zone shift).
  const xlDate = (ymd) => {
    if (!ymd) return null;
    const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
  };
  const records = result.rows.map((r) => ({ cells: r.map((v, i) => (result.columns[i].type === "date" ? xlDate(v) : v)) }));
  const summable = (c) => c.type === "number" && !/%|days left|months/i.test(c.label);
  if (result.columns.some(summable) && result.rows.length) {
    records.push({
      highlight: true,
      cells: result.columns.map((c, i) =>
        summable(c) ? result.rows.reduce((s, r) => s + (typeof r[i] === "number" ? r[i] : 0), 0) : i === 0 ? "TOTAL" : null
      ),
    });
  }

  let r = HEADER_ROW + 1;
  if (!records.length) {
    sheet.mergeCells(r, 1, r, lastCol);
    const cell = sheet.getCell(r, 1);
    cell.value = empty;
    cell.font = { name: FONT, size: 11, italic: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    sheet.getRow(r).height = 24;
  }
  for (const rec of records) {
    const row = sheet.getRow(r);
    // Excel doesn't auto-fit generated rows: size each from its longest wrapped text.
    const lines = Math.max(
      1,
      ...columns.map((c, i) => {
        const v = rec.cells[i];
        return typeof v === "string" && v ? Math.ceil(v.length / Math.max(1, c.width * 0.8)) : 1;
      })
    );
    row.height = Math.max(20, lines * 15 + 8);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const value = rec.cells[i] ?? null;
      cell.value = value;
      cell.font = { name: FONT, size: 11 };
      cell.alignment = { horizontal: c.align || "center", vertical: "middle", wrapText: true };
      cell.border = { top: thin, bottom: thin, left: thin, right: thin };
      if (c.numFmt && typeof value !== "string") cell.numFmt = c.numFmt;
      if (rec.highlight) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT_FILL } };
    });
    r += 1;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The template's filters in words ("Type of Contract: DIRECT LEASE"), as the
 * page's export subtitle shows them. */
async function filterText(dataset, filters = {}) {
  const d = DATASETS[dataset];
  if (!d) return [];
  const options = await optionLists();
  const out = [];
  for (const [k, raw] of Object.entries(filters || {})) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if (k === MISSING_FILTER) {
      if (d.columns[v]) out.push(`Missing data in: ${d.columns[v].label}`);
      continue;
    }
    const f = d.filters[k];
    if (!f) continue;
    const label = f.options ? (options[f.options] || []).find((o) => o.value === v)?.label : null;
    const dateText = f.type === "date" ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
    out.push(`${f.label}: ${label || dateText || v}`);
  }
  return out;
}

module.exports = { DATASETS, MAX_ROWS, catalog, run, quickTotal, quickTotalOptions, totalsAsTable, getTemplate, listDueRecurring, markSent, buildWorkbook, filterText, ensureSchema, listTemplates, saveTemplate, deleteTemplate };
