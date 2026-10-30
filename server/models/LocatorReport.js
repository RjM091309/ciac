// Reports built on the Registered Locator data (checklist G-09, G-10, G-13):
// CIAC's Quarterly Approved Investments, the locator status lists
// (existing / expiring / renewed / expired), GIS filing, and the summary
// figures. Every report covers the same set of locators as the Registered
// Locator list (manually registered, or with an approved application).
const { selectData } = require("../config/database");
const { expiringWindowDays } = require("./Permit");
const { parseAmount, parseMoney, getTopInvestments, getTopEmployees, getLeaseArea, REGISTERED_SQL, USD_TEXT } = require("./Report");

/* --------------------------------- period --------------------------------- */

const QUARTER_LABELS = ["1st Quarter", "2nd Quarter", "3rd Quarter", "4th Quarter"];

const pad = (n) => String(n).padStart(2, "0");
/** DATE columns arrive as UTC midnight: read them back as UTC. */
const dateYmd = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
/** DATETIME2 values are instants: the local (Philippine) calendar date. */
const localYmd = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const todayYmd = () => localYmd(new Date());

function addMonths(ymd, months) {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** ?year=2026&quarter=1 — no quarter means the whole year. Throws a plain
 * Error (shown to the user) on anything else, and on a period that hasn't
 * started: "as of" it there is nothing to report yet. */
function readPeriod({ year, quarter } = {}) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1990 || y > 2100) throw new Error("Pick a year.");
  const q = quarter == null || quarter === "" ? null : Number(quarter);
  if (q !== null && ![1, 2, 3, 4].includes(q)) throw new Error("Pick a quarter (1 to 4).");
  const from = q ? `${y}-${pad((q - 1) * 3 + 1)}-01` : `${y}-01-01`;
  if (from > todayYmd()) throw new Error("That period hasn't started yet.");
  const to = q ? addMonths(from, 3).replace(/-\d\d$/, "-01") : `${y + 1}-01-01`;
  const end = new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return { year: y, quarter: q, from, to: end, label: q ? `${QUARTER_LABELS[q - 1]} ${y}` : `Year ${y}` };
}

function quarterOf(ymd) {
  return Math.floor((Number(ymd.slice(5, 7)) - 1) / 3) + 1;
}

/* --------------------------------- money ---------------------------------- */

/** PHP unless the amount or its currency says USD. Investment figures are
 * free text with no currency field ("USD 2,500,000", "$1.2M"). */
function currencyOf(text, field) {
  const f = String(field || "").trim().toUpperCase();
  if (f) return f;
  return USD_TEXT.test(String(text || "")) ? "USD" : "PHP";
}

function money(text, field) {
  const amount = parseMoney(text);
  return amount === null ? null : { amount, currency: currencyOf(text, field) };
}

/* ------------------------- Quarterly Approved Investments ------------------ */

/** CIAC's "Compilation of the Quarterly Approved Investments" (G-13 template,
 * G-09 committed investments): one entry per lease agreement signed in the
 * period — new locators and renewals — with the company's stockholders.
 * Date of Registration = the lease's Date Signed; Date of Approval = the day
 * the BDO Manager (or the AO Manager, for a renewal) approved the application
 * in the system. Project Cost and Labor are the committed figures. */
async function getQuarterlyInvestments(query) {
  const period = readPeriod(query);
  await ensureTables();
  const leases = await selectData(
    `SELECT l.id AS lease_id, l.proponent_id, l.ref_code, l.date_signed,
            p.ref_no, p.business_name, p.business_activities,
            p.paid_up_capital, p.paid_up_capital_currency,
            sec.primary_purpose,
            a.application_no, a.is_renewal, ap.decided_at AS approved_at,
            inv.commitment AS investment, emp.commitment AS employees
     FROM dbo.proponent_leases l
     INNER JOIN dbo.proponents p ON p.id = l.proponent_id
     LEFT JOIN dbo.proponent_sec_registration sec ON sec.proponent_id = p.id AND sec.is_active = 1
     LEFT JOIN dbo.applications a ON a.id = l.application_id
     LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id AND ap.decision = 'APPROVED'
     LEFT JOIN dbo.proponent_investment inv ON inv.proponent_id = p.id AND inv.metric_type = 'INVESTMENT' AND inv.is_active = 1
     LEFT JOIN dbo.proponent_investment emp ON emp.proponent_id = p.id AND emp.metric_type = 'EMPLOYEE_COUNT' AND emp.is_active = 1
     WHERE l.is_active = 1 AND p.is_active = 1 AND ${REGISTERED_SQL}
       AND l.date_signed >= @param0 AND l.date_signed <= @param1
     ORDER BY l.date_signed, p.business_name, l.id`,
    [period.from, period.to]
  );
  // Same lease filter as above (not an IN list of ids, which would hit SQL
  // Server's 2,100-parameter limit on a big year).
  const holders = leases.length
    ? await selectData(
        `SELECT s.proponent_id, s.nationality, s.ownership
         FROM dbo.stockholder s
         INNER JOIN dbo.proponents p ON p.id = s.proponent_id
         WHERE s.is_active = 1 AND p.is_active = 1 AND ${REGISTERED_SQL}
           AND EXISTS (SELECT 1 FROM dbo.proponent_leases l
                       WHERE l.proponent_id = p.id AND l.is_active = 1
                         AND l.date_signed >= @param0 AND l.date_signed <= @param1)
         ORDER BY s.proponent_id, s.id`,
        [period.from, period.to]
      )
    : [];

  const rows = leases.map((l) => {
    const signed = dateYmd(l.date_signed);
    const projectCost = money(l.investment);
    const paidUp = money(l.paid_up_capital, l.paid_up_capital_currency);
    const labor = parseAmount(l.employees);
    return {
      lease_id: l.lease_id,
      proponent_id: l.proponent_id,
      ref_no: l.ref_no || null,
      ref_code: l.ref_code || null,
      firm_name: l.business_name,
      is_renewal: Boolean(l.is_renewal),
      application_no: l.application_no || null,
      quarter: quarterOf(signed),
      date_registration: signed,
      date_approval: localYmd(l.approved_at),
      stockholders: holders
        .filter((s) => s.proponent_id === l.proponent_id)
        .map((s) => ({
          nationality: String(s.nationality || "").replace(/\s+/g, " ").trim().toUpperCase() || null,
          ownership: Number(s.ownership) || 0,
        })),
      activity: String(l.business_activities || "").trim() || String(l.primary_purpose || "").trim() || null,
      project_cost: projectCost,
      project_cost_text: String(l.investment || "").trim() || null,
      paid_up_capital: paidUp,
      paid_up_capital_text: String(l.paid_up_capital || "").trim() || null,
      labor: labor === null ? null : Math.round(labor),
      foreign_currency: [projectCost, paidUp].some((m) => m && m.currency !== "PHP"),
    };
  });
  return { period, rows };
}

/* ----------------------------- Locator status ------------------------------ */

/** Every lease of every registered locator, with its effective dates (an
 * approved contract's dates win) and, on the current lease, the Extension
 * Date when it runs past the end of term. */
async function loadLeases() {
  await ensureTables();
  const rows = await selectData(
    `SELECT p.id AS proponent_id, p.ref_no, p.business_name, p.extension_date,
            u.full_name AS account_officer,
            l.id AS lease_id, l.is_current, l.ref_code, l.date_signed,
            CAST(COALESCE(c.effective_start, l.start_term) AS DATE) AS start_term,
            CAST(COALESCE(c.effective_end, l.end_term) AS DATE) AS end_term,
            a.application_no, a.is_renewal, ap.decided_at AS approved_at,
            toc.name AS contract_type
     FROM dbo.proponents p
     INNER JOIN dbo.proponent_leases l ON l.proponent_id = p.id AND l.is_active = 1
     LEFT JOIN dbo.contracts c ON c.id = l.contract_id
     LEFT JOIN dbo.applications a ON a.id = l.application_id
     LEFT JOIN dbo.application_approvals ap ON ap.application_id = a.id AND ap.decision = 'APPROVED'
     LEFT JOIN dbo.type_of_contract toc ON toc.id = COALESCE(l.contract_type_id, c.contract_type_id, a.contract_type_id)
     LEFT JOIN dbo.users u ON u.id = p.account_officer_id
     WHERE p.is_active = 1 AND ${REGISTERED_SQL}
     ORDER BY p.business_name, p.id, l.id`
  );
  const byLocator = new Map();
  for (const r of rows) {
    let loc = byLocator.get(r.proponent_id);
    if (!loc) {
      loc = {
        proponent_id: r.proponent_id,
        ref_no: r.ref_no || null,
        business_name: r.business_name,
        account_officer: r.account_officer || null,
        leases: [],
      };
      byLocator.set(r.proponent_id, loc);
    }
    const termEnd = dateYmd(r.end_term);
    const extension = r.is_current ? dateYmd(r.extension_date) : null;
    const extended = Boolean(extension && (!termEnd || extension > termEnd));
    loc.leases.push({
      lease_id: r.lease_id,
      is_current: Boolean(r.is_current),
      ref_code: r.ref_code || null,
      contract_type: r.contract_type || null,
      date_signed: dateYmd(r.date_signed),
      start: dateYmd(r.start_term),
      term_end: termEnd,
      end: extended ? extension : termEnd,
      extended,
      application_no: r.application_no || null,
      is_renewal: Boolean(r.is_renewal),
      approved_at: localYmd(r.approved_at),
    });
  }
  return [...byLocator.values()];
}

/** G-10. As of the end of the period (or today, for a period still running):
 * - existing: a lease is in effect;
 * - expiring: in effect, and ends within the Portal Settings → Renewals
 *   expiring window (default 6 months);
 * - expired: its last lease ended during the period and nothing is in effect;
 * - renewed: a renewal was approved during the period.
 * The Extension Date counts as the end of the current lease. */
async function getLocatorStatus(query) {
  const period = readPeriod(query);
  const today = todayYmd();
  const asOf = period.to < today ? period.to : today;
  const windowDays = expiringWindowDays();
  const windowEnd = new Date(Date.parse(`${asOf}T00:00:00Z`) + windowDays * 86400000).toISOString().slice(0, 10);
  const lists = { existing: [], expiring: [], expired: [], renewed: [] };
  let noDates = 0;

  const started = period.from <= asOf;
  for (const loc of await loadLeases()) {
    const base = { proponent_id: loc.proponent_id, ref_no: loc.ref_no, business_name: loc.business_name, account_officer: loc.account_officer };
    const dated = loc.leases.filter((l) => l.end);
    if (!dated.length) {
      noDates += 1;
      continue;
    }
    const inEffect = dated
      .filter((l) => (!l.start || l.start <= asOf) && l.end >= asOf)
      .sort((a, b) => Number(b.is_current) - Number(a.is_current) || b.end.localeCompare(a.end))[0];
    const row = (l) => ({
      ...base,
      lease_id: l.lease_id,
      ref_code: l.ref_code,
      contract_type: l.contract_type,
      start: l.start,
      end: l.end,
      term_end: l.term_end,
      extended: l.extended,
    });
    if (inEffect) {
      lists.existing.push({ ...row(inEffect), days_left: daysBetween(asOf, inEffect.end) });
      if (inEffect.end <= windowEnd) lists.expiring.push({ ...row(inEffect), days_left: daysBetween(asOf, inEffect.end) });
    } else if (started) {
      const last = [...dated].sort((a, b) => b.end.localeCompare(a.end))[0];
      if (last.end >= period.from && last.end < asOf) lists.expired.push({ ...row(last), days_since: daysBetween(last.end, asOf) });
    }
    for (const l of loc.leases) {
      const when = l.is_renewal ? l.approved_at || l.date_signed || l.start : null;
      if (when && when >= period.from && when <= asOf) {
        const previous = loc.leases
          .filter((p) => p.lease_id !== l.lease_id && p.end && (!l.start || p.end <= l.start))
          .sort((a, b) => b.end.localeCompare(a.end))[0];
        lists.renewed.push({ ...row(l), application_no: l.application_no, renewed_on: when, previous_end: previous?.end || null });
      }
    }
  }
  lists.expiring.sort((a, b) => a.end.localeCompare(b.end));
  lists.expired.sort((a, b) => b.end.localeCompare(a.end));
  lists.renewed.sort((a, b) => b.renewed_on.localeCompare(a.renewed_on));
  return { period, as_of: asOf, expiring_window_days: windowDays, without_dates: noDates, ...lists };
}

/* ----------------------------------- GIS ----------------------------------- */

/** G-09 GIS output: each registered locator's Latest GIS Filing (SEC
 * Registration Information) and its latest "GIS" compliance document.
 * A filing counts as current for 12 months — the GIS is filed every year. */
async function getGisFiling() {
  await ensureTables();
  await require("./ComplianceDocument").ensureSchema();
  const rows = await selectData(
    `SELECT p.id AS proponent_id, p.ref_no, p.business_name, u.full_name AS account_officer,
            sec.gis_date, d.id AS document_id, d.original_file_name, d.file_name, d.status AS document_status,
            d.validity_to, d.uploaded_at
     FROM dbo.proponents p
     LEFT JOIN dbo.proponent_sec_registration sec ON sec.proponent_id = p.id AND sec.is_active = 1
     LEFT JOIN dbo.users u ON u.id = p.account_officer_id
     OUTER APPLY (SELECT TOP (1) * FROM dbo.locator_compliance_documents x
                  WHERE x.proponent_id = p.id AND x.item_code = 'GIS' ORDER BY x.id DESC) d
     WHERE p.is_active = 1 AND ${REGISTERED_SQL}
     ORDER BY p.business_name, p.id`
  );
  const today = todayYmd();
  const yearAgo = addMonths(today, -12);
  return {
    as_of: today,
    rows: rows.map((r) => {
      const filed = dateYmd(r.gis_date);
      const validTo = dateYmd(r.validity_to);
      const status = String(r.document_status || "").toUpperCase();
      return {
        proponent_id: r.proponent_id,
        ref_no: r.ref_no || null,
        business_name: r.business_name,
        account_officer: r.account_officer || null,
        gis_date: filed,
        filing_status: !filed ? "NONE" : filed >= yearAgo ? "CURRENT" : "OVERDUE",
        document: r.document_id
          ? {
              id: r.document_id,
              file_name: r.original_file_name || r.file_name || null,
              valid_until: validTo,
              uploaded_at: localYmd(r.uploaded_at),
              status:
                status === "REJECTED" ? "REJECTED" : status === "SUBMITTED" ? "PENDING" : validTo && validTo < today ? "EXPIRED" : "VALID",
            }
          : null,
      };
    }),
  };
}

/* --------------------------------- Summary --------------------------------- */

function sumByCurrency(list) {
  const out = {};
  for (const m of list) if (m) out[m.currency] = (out[m.currency] || 0) + m.amount;
  return out;
}

/** G-13's figures for the period: locators (registered / with a lease in
 * effect), the status lists' counts, lease agreements, new registrations and
 * renewals, committed investment and employees, top 3 by investment and by
 * employees, and the leased area. The escalation rate waits on A-13. */
async function getSummary(query) {
  const period = readPeriod(query);
  const [status, investments, registered, leaseCount, commitments, topInvestments, topEmployees, leaseArea] = await Promise.all([
    getLocatorStatus(query),
    getQuarterlyInvestments(query),
    selectData(`SELECT COUNT(*) AS n FROM dbo.proponents p WHERE p.is_active = 1 AND ${REGISTERED_SQL}`),
    selectData(
      `SELECT COUNT(*) AS n FROM dbo.proponent_leases l INNER JOIN dbo.proponents p ON p.id = l.proponent_id
       WHERE l.is_active = 1 AND p.is_active = 1 AND ${REGISTERED_SQL}`
    ),
    selectData(
      `SELECT i.metric_type, i.commitment FROM dbo.proponent_investment i INNER JOIN dbo.proponents p ON p.id = i.proponent_id
       WHERE i.is_active = 1 AND p.is_active = 1 AND ${REGISTERED_SQL}`
    ),
    getTopInvestments(3),
    getTopEmployees(3),
    getLeaseArea(),
  ]);
  const signed = investments.rows;
  return {
    period,
    as_of: status.as_of,
    locators: {
      registered: registered[0]?.n ?? 0,
      existing: status.existing.length,
      expiring: status.expiring.length,
      expired: status.expired.length,
      renewed: status.renewed.length,
      without_dates: status.without_dates,
    },
    leases: {
      total: leaseCount[0]?.n ?? 0,
      signed_in_period: signed.length,
      new_in_period: signed.filter((r) => !r.is_renewal).length,
      renewals_in_period: signed.filter((r) => r.is_renewal).length,
    },
    commitment: {
      investment_all: sumByCurrency(commitments.filter((c) => c.metric_type === "INVESTMENT").map((c) => money(c.commitment))),
      employees_all: commitments
        .filter((c) => c.metric_type === "EMPLOYEE_COUNT")
        .reduce((n, c) => n + Math.round(parseAmount(c.commitment) || 0), 0),
      investment_period: sumByCurrency(signed.map((r) => r.project_cost)),
      employees_period: signed.reduce((n, r) => n + (r.labor || 0), 0),
    },
    top_investments: topInvestments,
    top_employees: topEmployees,
    lease_area: leaseArea,
    escalation: null,
  };
}

/* ---------------------------------- schema --------------------------------- */

// The tables these reports read are created by their own models; on a fresh
// database some only exist once those have run.
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = Promise.all([
      require("./Proponent").ensureSchema(),
      require("./ProponentLease").ensureSchema(),
      require("./SecRegistration").ensureSchema(),
      require("./Stockholder").ensureSchema(),
      require("./Investment").ensureSchema(),
    ]).catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

module.exports = { readPeriod, getQuarterlyInvestments, getLocatorStatus, getGisFiling, getSummary };
