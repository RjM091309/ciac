// Custom Report (Reports & Analytics → Custom Report): the user picks a
// dataset, the columns and the filters, previews the rows and exports them
// (Excel / CSV built in the browser). Every column, filter and sort is from
// the catalog below — nothing the client sends goes into the SQL as text, only
// as parameters. A Level 2 Account Officer sees only their own locators.
// Saved setups ("templates") are per user (dbo.report_templates).
const { selectData, updateData, updateSchema, insertData } = require("../config/database");
const { decryptValue } = require("../lib/crypto");

const MAX_ROWS = 10000;

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

const DATASETS = {
  locators: {
    label: "Registered Locators",
    description: "One row per registered locator.",
    from: `FROM dbo.proponents p ${CONTRACT_TYPE_APPLY}`,
    where: ["p.account_officer_id IS NOT NULL"],
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
      status: { label: "Status", sql: "CASE WHEN p.is_active = 1 THEN 'Active' ELSE 'Inactive' END" },
      created_at: { label: "Encoded On", sql: "p.created_at", type: "date" },
    },
    defaults: ["ref_code", "business_name", "nationality", "type_of_contract", "account_officer", "start_term", "end_term", "status"],
    filters: {
      contract_type_id: { label: "Type of Contract", type: "select", options: "contractTypes", sql: "toc.id = @v" },
      account_officer_id: { label: "Account Officer", type: "select", options: "accountOfficers", sql: "p.account_officer_id = @v" },
      nationality: { label: "Nationality", type: "select", options: "nationalities", sql: "UPPER(LTRIM(RTRIM(p.nationality))) = @v" },
      status: { label: "Status", type: "select", options: "activeStatus", sql: "p.is_active = @v" },
      end_from: { label: "End Term from", type: "date", sql: "CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE) >= @v" },
      end_to: { label: "End Term to", type: "date", sql: "CAST(COALESCE(ct.effective_end, p.manual_end_term) AS DATE) <= @v" },
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
      track: { label: "New / Renewal", sql: "CASE WHEN a.is_renewal = 1 THEN 'Renewal' ELSE 'New' END" },
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
    where: ["s.is_active = 1", "p.account_officer_id IS NOT NULL"],
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
    where: ["l.is_active = 1", "p.account_officer_id IS NOT NULL"],
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
    filters: Object.entries(d.filters).map(([k, f]) => ({ key: k, label: f.label, type: f.type, options: f.options ? options[f.options] || [] : undefined })),
  }));
}

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
  for (const [key, raw] of Object.entries(filters || {})) {
    const f = d.filters[key];
    const value = String(raw ?? "").trim();
    if (!f || !value) continue;
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${f.label}: not a date.`);
    where.push(f.sql.replace("@v", param(f.type === "date" ? value : value.slice(0, 200))));
  }
  if (ownOfficerId) where.push(`p.account_officer_id = ${param(Number(ownOfficerId))}`);

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
  const rows = await selectData(
    `SELECT id, name, dataset, config, created_at, updated_at FROM dbo.report_templates WHERE user_id = @param0 ORDER BY name`,
    [Number(userId)]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, dataset: r.dataset, config: parseConfig(r.config), updated_at: r.updated_at || r.created_at }));
}

/** Saves (or, same name, replaces) one of the user's templates. */
async function saveTemplate(userId, { name, dataset, columns, filters, sort }) {
  await ensureSchema();
  const title = String(name || "").trim().slice(0, 120);
  if (!title) throw badRequest("Name the template.");
  const d = DATASETS[dataset];
  if (!d) throw badRequest("Choose what to report on.");
  const config = JSON.stringify({
    columns: (Array.isArray(columns) ? columns : []).filter((k) => d.columns[k]),
    filters: Object.fromEntries(Object.entries(filters || {}).filter(([k, v]) => d.filters[k] && String(v ?? "").trim())),
    sort: sort?.key && d.columns[sort.key] ? { key: sort.key, dir: sort.dir === "desc" ? "desc" : "asc" } : null,
  });
  const existing = await selectData(`SELECT id FROM dbo.report_templates WHERE user_id = @param0 AND name = @param1`, [Number(userId), title]);
  if (existing[0]) {
    await updateData(
      `UPDATE dbo.report_templates SET dataset = @param1, config = @param2, updated_at = SYSUTCDATETIME() WHERE id = @param0`,
      [existing[0].id, dataset, config]
    );
    return existing[0].id;
  }
  const result = await insertData(
    `INSERT INTO dbo.report_templates (user_id, name, dataset, config) OUTPUT inserted.id VALUES (@param0, @param1, @param2, @param3)`,
    [Number(userId), title, dataset, config]
  );
  return result?.recordset?.[0]?.id ?? null;
}

async function deleteTemplate(userId, id) {
  await ensureSchema();
  const result = await updateData(`DELETE FROM dbo.report_templates WHERE id = @param0 AND user_id = @param1`, [Number(id), Number(userId)]);
  return Boolean(result?.rowsAffected?.[0]);
}

module.exports = { DATASETS, MAX_ROWS, catalog, run, ensureSchema, listTemplates, saveTemplate, deleteTemplate };
