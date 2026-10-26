// The lease agreement Level 2 generates as a Word file to finish, print and
// have notarized. Filled from the client's own template
// (server/templates/lease-agreement.docx — their 2025 renewal sample with
// {{TOKENS}} in place of the sample locator), so its font, sizes and long
// bond paper stay exactly as they made it. A new locator gets the same
// agreement titled "LEASE AGREEMENT", without the previous-lease clause, and
// "its intention to lease" instead of "to renew said Lease Agreement".
//
// Most values come from the system (locator, address, dates); the rest —
// representative, notarial details of the previous lease, the Board
// resolution — Level 2 types in the form, and they're kept per application.
// The representative carries over to the locator's next renewal. CIAC's
// signatory comes from Portal Settings → Renewals.
const fs = require("fs");
const path = require("path");
const { selectData, updateData, updateSchema } = require("../config/database");
const { fillDocx } = require("./docxFill");
const { get: setting } = require("./siteSettings");

const TEMPLATE = path.join(__dirname, "..", "templates", "lease-agreement.docx");
const BLANK = "________";

/** The form, in order. `system` = prefilled from the records; `address` =
 * Google address search, as on Locator Accounts; `renewal` = only in a
 * renewal's agreement. */
const FIELDS = [
  { key: "lessee_name", label: "Lessee (registered name)", system: true },
  {
    key: "lessee_short",
    label: "Short name / acronym",
    hint: "e.g. JPI — shown as (JPI); leave empty for none",
  },
  {
    key: "lessee_address",
    label: "Principal office address",
    system: true,
    address: true,
  },
  {
    key: "rep_name",
    label: "Representative",
    hint: "Who signs for the lessee, e.g. KEIJI OZAWA",
  },
  {
    key: "rep_title",
    label: "Representative's title",
    hint: "e.g. Chairman, President",
  },
  {
    key: "rep_pronoun",
    label: "Representative (his / her)",
    options: ["his", "her"],
  },
  {
    key: "premises",
    label: "Leased premises",
    system: true,
    address: true,
    hint: "e.g. portion of Bldg. N7000",
  },
  {
    key: "lease_description",
    label: "Lease of (premises and use)",
    system: true,
    multiline: true,
    hint: "e.g. portion of Bldg. N7000 manufacturing aircraft parts and equipment",
  },
  {
    key: "prev_lease_date",
    label: "Date of the previous lease agreement",
    system: true,
    renewal: true,
  },
  {
    key: "prev_notary",
    label: "Notarial registration of the previous lease",
    multiline: true,
    renewal: true,
    hint: "e.g. Atty. Juan Dela Cruz with entry Doc. No. 1037; Page No. 29; Book No. XIV; Series of 2021",
  },
  {
    key: "intent_date",
    label: "Date of the locator's letter of intent",
    system: true,
  },
  { key: "board_date", label: "Date of the Board approval" },
  {
    key: "board_resolution",
    label: "Board Resolution No.",
    hint: "e.g. 2024-12-001, Series of 2024",
  },
];
const KEYS = FIELDS.map((f) => f.key);

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.application_lease_agreement', 'U') IS NULL
      CREATE TABLE dbo.application_lease_agreement (
        application_id INT NOT NULL PRIMARY KEY,
        data NVARCHAR(MAX) NOT NULL,
        updated_by INT NULL,
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_application_lease_agreement_updated_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_application_lease_agreement_application FOREIGN KEY (application_id)
          REFERENCES dbo.applications(id) ON DELETE CASCADE
      );
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "22 June 2021", as written in the agreement. */
function longDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function parse(json) {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function context(applicationId) {
  const rows = await selectData(
    `
    SELECT TOP (1) a.id, a.application_no, a.is_renewal, a.created_at, a.submitted_at, a.proponent_id,
           p.business_name, p.address, p.lease_address, p.location, p.date_signed,
           prev.issue_date AS prev_issue_date
    FROM dbo.applications a
    INNER JOIN dbo.proponents p ON p.id = a.proponent_id
    LEFT JOIN dbo.permits prev ON prev.id = a.renewed_from_permit_id
    WHERE a.id = @param0
    `,
    [Number(applicationId)]
  );
  return rows?.[0] || null;
}

/** System values, then the representative from this locator's last agreement. */
async function defaults(ctx) {
  const premises = ctx.lease_address || ctx.location || "";
  const out = {
    lessee_name: ctx.business_name || "",
    lessee_short: "",
    lessee_address: ctx.address || "",
    rep_name: "",
    rep_title: "",
    rep_pronoun: "his",
    premises,
    lease_description: premises,
    prev_lease_date: longDate(ctx.prev_issue_date || ctx.date_signed),
    prev_notary: "",
    intent_date: longDate(ctx.submitted_at || ctx.created_at),
    board_date: "",
    board_resolution: "",
  };
  const last = await selectData(
    `
    SELECT TOP (1) la.data FROM dbo.application_lease_agreement la
    INNER JOIN dbo.applications a ON a.id = la.application_id
    WHERE a.proponent_id = @param0 AND a.id <> @param1
    ORDER BY la.updated_at DESC
    `,
    [ctx.proponent_id, ctx.id]
  );
  const prior = parse(last?.[0]?.data);
  for (const k of ["lessee_short", "rep_name", "rep_title", "rep_pronoun"]) if (prior[k]) out[k] = prior[k];
  return out;
}

/** The form: field list and current values (saved, else defaults). */
async function getForm(applicationId) {
  await ensureSchema();
  const ctx = await context(applicationId);
  if (!ctx) return null;
  const saved = await selectData(`SELECT data FROM dbo.application_lease_agreement WHERE application_id = @param0`, [ctx.id]);
  const values = { ...(await defaults(ctx)), ...parse(saved?.[0]?.data) };
  return {
    fields: FIELDS,
    values,
    is_renewal: Boolean(Number(ctx.is_renewal)),
    saved: Boolean(saved?.[0]),
  };
}

function clean(values) {
  const out = {};
  // One line each: a line break inside Word's text run wouldn't show.
  for (const k of KEYS) out[k] = String(values?.[k] ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, 2000);
  if (!["his", "her"].includes(out.rep_pronoun)) out.rep_pronoun = "his";
  return out;
}

/** Saves the form and returns the filled Word file. */
async function generate(applicationId, values, actorId) {
  await ensureSchema();
  const ctx = await context(applicationId);
  if (!ctx) return null;
  const v = clean(values);
  await updateData(
    `
    MERGE dbo.application_lease_agreement AS t
    USING (SELECT @param0 AS application_id) AS s ON t.application_id = s.application_id
    WHEN MATCHED THEN UPDATE SET data = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (application_id, data, updated_by) VALUES (@param0, @param1, @param2);
    `,
    [ctx.id, JSON.stringify(v), Number(actorId) || null]
  );
  return fill(ctx, v);
}

/** The Word file from what's saved (else the defaults) — for the PDF package. */
async function current(applicationId) {
  const form = await getForm(applicationId);
  if (!form) return null;
  return fill(await context(applicationId), clean(form.values));
}

async function fill(ctx, v) {
  const renewal = Boolean(Number(ctx.is_renewal));
  const or = (x) => x || BLANK;
  const s = (name) => String(setting(`renewals.contract_${name}`) || "").trim();
  const bytes = await fillDocx(
    fs.readFileSync(TEMPLATE),
    {
      "{{TITLE}}": renewal ? "RENEWAL OF LEASE AGREEMENT" : "LEASE AGREEMENT",
      "{{INTENT_PHRASE}}": renewal ? "its intention to renew said Lease Agreement; covering" : "its intention to lease",
      "{{RENEWAL_ONLY}}": "",
      "{{LESSEE_NAME}}": or(v.lessee_name),
      "{{LESSEE_NAME_REG}}": or(v.lessee_name),
      "{{LESSEE_SHORT}}": v.lessee_short ? ` (${v.lessee_short})` : "",
      "{{LESSEE_ADDRESS}}": or(v.lessee_address),
      "{{REP_NAME}}": or(v.rep_name),
      "{{REP_TITLE}}": or(v.rep_title),
      "{{REP_PRONOUN}}": v.rep_pronoun,
      "{{PREMISES}}": or(v.premises),
      "{{LEASE_DESCRIPTION}}": or(v.lease_description),
      "{{PREV_LEASE_DATE}}": or(v.prev_lease_date),
      "{{PREV_NOTARY}}": or(v.prev_notary),
      "{{INTENT_DATE}}": or(v.intent_date),
      "{{BOARD_DATE}}": or(v.board_date),
      "{{BOARD_RESOLUTION}}": v.board_resolution || `${BLANK}, Series of 20__`,
      "{{CIAC_SIGNATORY}}": or(s("signatory_name")),
      "{{CIAC_TITLE}}": or(s("signatory_title")),
      "{{CIAC_TITLE_SHORT}}": or(s("signatory_title_short")),
      "{{CIAC_PRONOUN}}": s("signatory_pronoun") === "her" ? "her" : "his",
      "{{CIAC_AUTHORITY}}": or(s("signatory_authority")),
      "{{CIAC_ID_TYPE}}": s("signatory_id_type"),
      "{{CIAC_ID_NO}}": or(s("signatory_id_no")),
      "{{CIAC_ID_ISSUED}}": or(s("signatory_id_issued")),
      "{{CIAC_ID_EXPIRY}}": or(s("signatory_id_expiry")),
      "{{CIAC_ID_PLACE}}": or(s("signatory_id_place")),
      "{{YEAR}}": String(new Date().getFullYear()),
    },
    // The previous-lease clause; it carries the {{RENEWAL_ONLY}} marker.
    { drop: renewal ? [] : ["{{RENEWAL_ONLY}}"] }
  );
  const safe = String(ctx.application_no || ctx.id).replace(/[^A-Za-z0-9-]+/g, "_");
  return { bytes, fileName: `Lease-Agreement-${safe}.docx` };
}

module.exports = { FIELDS, getForm, generate, current, ensureSchema };
