/**
 * Imports the locators of the legacy BRIDGE system into this app — the
 * complete record, replacing migrate-legacy-locators.js +
 * backfill-legacy-profile-fields.js (which only carried half of it and hung
 * every locator on a shared placeholder login).
 *
 * BRIDGE kept every renewal / extension / amendment as its own row; here they
 * become one locator with Lease Agreements history (see buildChains).
 * BRIDGE's RefCode is the SEC Registration No. (registration_no here); the
 * Ref. Code (per lease, typed by the Account Officer) is left blank.
 *
 * Each legacy locator (dbLocator, not deleted) becomes a Registered Locator
 * encoded the same way as one added by hand on Registered Locator → New
 * Locator (is_manual_registration): no application, Start/End Term typed in,
 * and a CONTRACT permit LEASE-<Ref No> so it shows on Renewal Tracking and
 * can be renewed. Carried over:
 *   - profile: name, TIN, addresses, Ref No (kept exactly as in BRIDGE — not
 *     converted to LOC-…), Ref Code, location, business activities, industry,
 *     type of contract, land use, SEC registration, date signed, grace period,
 *     sub-lease, PGRO/PGRR, extension, capital (authorized/subscribed/paid-up)
 *   - Industry Type / Type of Contract: matched by name; a legacy Type of
 *     Contract with a different name here maps to the closest one (LEASE
 *     AGREEMENT → DIRECT LEASE, SHORT-TERM… → SHORT TERM LEASE, …SUBLEASE… →
 *     SUBLEASE AGREEMENT), and when the legacy industry (MANUFACTURING…) isn't
 *     an Industry Type here, the Industry Type follows the contract (Direct
 *     Lease / Sublease) and the legacy industry is kept in Business Activities
 *   - Account Officer: matched by name to an existing Account Officer user
 *     (create their accounts first); unmatched names are only reported — the
 *     locator stays without one until Level 1 assigns it
 *   - stockholders, contact persons, signatories
 *   - advance lease payment, security deposit, performance security
 *   - investment and employee commitment/actual
 *   - building details (as a property row)
 *   - the documents stored in the legacy database (contract attachments and
 *     additional documents, ~6 GB) → locators/<Ref No>/documents/, shown on
 *     the locator's Documents tab
 *
 * No portal login is created: a legacy locator gets one only when staff adds
 * an email (Registered Locator → Portal login), and nothing is emailed before
 * that. Emails found on contact persons / signatories stay on those records.
 *
 * Safe to re-run: a Ref No already in this app is never touched again, except
 * that documents not yet imported for a locator this script created are
 * added (tracked by file hash in dbo.legacy_import_files).
 *
 * Usage (from the server folder; LEGACY_DB = the legacy database's name):
 *   node scripts/import-legacy-locators.js                    dry run: shows what would happen
 *   node scripts/import-legacy-locators.js --apply            imports everything
 *   node scripts/import-legacy-locators.js --apply --skip-documents
 *                                                             data only (documents in a later run)
 *   node scripts/import-legacy-locators.js --only=2024000001  one locator (with or without --apply)
 *   node scripts/import-legacy-locators.js --apply --no-officers
 *                                                             no Account Officer on any locator (assign later)
 *   node scripts/import-legacy-locators.js --resync [--apply] [--only=…] [--no-officers]
 *                                                             re-applies the legacy data to the locators
 *                                                             this import created and nobody has worked on
 *                                                             since (only differing values are written)
 *   node scripts/import-legacy-locators.js --remove [--apply] undoes this import (only locators it
 *                                                             created that have no application and no
 *                                                             portal login yet), files included
 *   LEGACY_DB=bridge_import node scripts/import-legacy-locators.js     (default: actual)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { selectData, updateData, updateSchema, runInTransaction, getDbConfig, sql } = require("../config/database");
const Proponent = require("../models/Proponent");
const Stockholder = require("../models/Stockholder");
const ContactPerson = require("../models/ContactPerson");
const Signatory = require("../models/Signatory");
const FinancialTerms = require("../models/FinancialTerms");
const Investment = require("../models/Investment");
const ProponentDocument = require("../models/ProponentDocument");
const Permit = require("../models/Permit");
const { encryptValue, decryptValue } = require("../lib/crypto");
const { locatorDir } = require("../lib/locatorFolders");
const { relativeStoragePath, resolveStoredPath } = require("../lib/fileStorage");

const APPLY = process.argv.includes("--apply");
const REMOVE = process.argv.includes("--remove");
const RESYNC = process.argv.includes("--resync");
const SKIP_DOCS = process.argv.includes("--skip-documents");
// Leave every locator without an Account Officer (assigned later on Registered Locator).
const NO_OFFICERS = process.argv.includes("--no-officers");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).trim() || null;
const LEGACY_DB = process.env.LEGACY_DB || "actual";
if (!/^\w+$/.test(LEGACY_DB)) throw new Error("LEGACY_DB must be a plain database name");
const L = `[${LEGACY_DB}].dbo`;
const NOT_DELETED = "(ISNULL(Deleted, 0) = 0)";

// ---------- small helpers ----------

const txt = (v, max = 4000) => {
  const s = v === undefined || v === null ? "" : String(v).replace(/\s+$/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const upperKey = (v) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
/** "TRISHA G. CAMELLO" and "Trisha Camello" → "TRISHA CAMELLO" (initials dropped). */
const personKey = (v) =>
  String(v || "")
    .replace(/\(legacy import\)/i, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1)
    .join(" ");
/** Every way BRIDGE may have written a staff member's name. Staff full_name is
 * the "AO - Jane_IP" label, so the name parts carry the match: "JANE PINEDA"
 * (first + last), "TRISHA CAMELLO" (a middle name + last — Robinne Trisha G.
 * Camello), "TJ GALVEZ" (initials + last — Tyronne Jeff D. Galvez), and the
 * username without spaces ("TJGALVEZ"). */
function officerKeys(u) {
  const keys = new Set([personKey(u.full_name), upperKey(u.username).replace(/[^A-Z0-9]/g, "")]);
  const last = personKey(u.last_name);
  const given = personKey(`${u.first_name || ""} ${u.middle_name || ""}`).split(" ").filter(Boolean);
  if (last && given.length) {
    for (const name of given) keys.add(`${name} ${last}`);
    for (let n = 2; n <= given.length; n += 1) keys.add(`${given.slice(0, n).map((t) => t[0]).join("")} ${last}`);
  }
  return [...keys].filter(Boolean);
}
const findOfficer = (name, lk) => {
  const key = personKey(name);
  return lk.officers.get(key) ?? lk.officers.get(key.replace(/ /g, "")) ?? null;
};
const currency = (v) => {
  const s = upperKey(v).replace(/[^A-Z$₱]/g, "");
  if (!s) return null;
  if (s.includes("$") || s === "USD") return "USD";
  if (s.startsWith("PHP") || s === "P" || s.includes("₱")) return "PHP";
  return null;
};
const sublease = (v) => {
  const s = upperKey(v);
  if (!s) return null;
  if (["1", "YES", "TRUE", "ALLOWED"].includes(s)) return 1;
  return 0; // NOT ALLOWED, NONE, 0, NO
};
const money = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const ymd = (d) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};
const mb = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

/** File type from its first bytes (the legacy table keeps no file name). */
function sniff(buf) {
  const hex = buf.subarray(0, 8).toString("hex").toUpperCase();
  if (hex.startsWith("25504446")) return { ext: ".pdf", type: "application/pdf" };
  if (hex.startsWith("FFD8FF")) return { ext: ".jpg", type: "image/jpeg" };
  if (hex.startsWith("89504E47")) return { ext: ".png", type: "image/png" };
  if (hex.startsWith("D0CF11E0")) return { ext: ".doc", type: "application/msword" };
  if (hex.startsWith("504B0304")) return { ext: ".zip", type: "application/zip" };
  return { ext: ".bin", type: "application/octet-stream" };
}
const safeFileName = (name) => String(name || "document").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);

// A separate pool with a long request timeout: some legacy files are large.
let blobPool = null;
async function blobQuery(query, params = []) {
  if (!blobPool) {
    blobPool = new sql.ConnectionPool({ ...getDbConfig(), requestTimeout: 10 * 60 * 1000 });
    await blobPool.connect();
  }
  const request = blobPool.request();
  params.forEach((p, i) => request.input(`param${i}`, p));
  return (await request.query(query)).recordset;
}

// ---------- schema owned by this script ----------

async function ensureImportSchema() {
  await updateSchema(`
    IF COL_LENGTH('dbo.proponents', 'legacy_imported_at') IS NULL
      ALTER TABLE dbo.proponents ADD legacy_imported_at DATETIME2(3) NULL;
    IF OBJECT_ID('dbo.legacy_import_files', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.legacy_import_files (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        ref_no NVARCHAR(50) NOT NULL,
        source NVARCHAR(30) NOT NULL,
        doc_name NVARCHAR(400) NULL,
        sha1 CHAR(40) NOT NULL,
        proponent_document_id INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_legacy_import_files_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE UNIQUE INDEX UX_legacy_import_files ON dbo.legacy_import_files(proponent_id, sha1);
    END
    -- Which locator / lease each legacy row became (renewals share a locator).
    IF OBJECT_ID('dbo.legacy_import_map', 'U') IS NULL
      CREATE TABLE dbo.legacy_import_map (
        legacy_ref_no NVARCHAR(50) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        lease_id INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_legacy_import_map_created_at DEFAULT (SYSUTCDATETIME())
      );
  `);
}
const hasImportMarker = async () =>
  Boolean((await selectData(`SELECT COL_LENGTH('dbo.proponents', 'legacy_imported_at') AS c`))?.[0]?.c);

// ---------- lookups ----------

async function loadLookups() {
  const byKey = (rows, keyFn, valFn) => {
    const map = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!k) continue;
      map.set(k, map.has(k) && map.get(k) !== valFn(r) ? null : valFn(r)); // ambiguous → null
    }
    return map;
  };
  const industries = byKey(await selectData(`SELECT code, name FROM dbo.application_types`), (r) => upperKey(r.name), (r) => r.code);
  const contractTypes = byKey(await selectData(`SELECT id, name FROM dbo.type_of_contract`), (r) => upperKey(r.name), (r) => r.id);
  const landUses = byKey(
    await selectData(`SELECT id, name FROM dbo.land_use`).catch(() => []),
    (r) => upperKey(r.name),
    (r) => r.id
  );
  // Account Officers: anyone whose role works the Approved Queue. Each is
  // reachable by every way BRIDGE wrote their name (see officerKeys).
  const officerRows = await selectData(`
    SELECT DISTINCT u.id, u.username, u.full_name, u.first_name, u.middle_name, u.last_name
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id AND r.is_active = 1
    INNER JOIN dbo.role_sidebar_menu_permissions p
      ON p.role_id = r.id AND p.menu_key = 'approval:queue' AND p.is_enabled = 1
    WHERE u.is_active = 1 AND LOWER(LTRIM(RTRIM(r.name))) NOT IN ('admin', 'proponent')
  `);
  const officers = byKey(
    officerRows.flatMap((u) => officerKeys(u).map((key) => ({ key, id: u.id }))),
    (r) => r.key,
    (r) => r.id
  );
  const usersByName = byKey(await selectData(`SELECT id, username FROM dbo.users`), (r) => upperKey(r.username), (r) => r.id);
  const admin = await selectData(`
    SELECT TOP (1) u.id FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id
    WHERE LOWER(LTRIM(RTRIM(r.name))) = 'admin' ORDER BY u.id
  `);
  if (!admin?.[0]?.id) throw new Error("No administrator account found — create one first (scripts/create-admin.js).");
  return { industries, contractTypes, landUses, officers, usersByName, adminId: admin[0].id };
}

async function loadLegacy() {
  const only = ONLY ? " AND RefNo = @param0" : "";
  const p = ONLY ? [ONLY] : [];
  const locators = await selectData(
    `SELECT * FROM ${L}.dbLocator WHERE ${NOT_DELETED}${only} ORDER BY RefNo`,
    p
  );
  const group = (rows, key = "RefNo") => {
    const map = new Map();
    for (const r of rows) {
      const k = String(r[key] || "").trim();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  };
  const stockholders = group(await selectData(`SELECT RefNo, StockName, Nationality, Subcribed, Paid, Ownership FROM ${L}.dbStockHolder WHERE ${NOT_DELETED}${only}`, p));
  const contacts = group(await selectData(`SELECT Refno AS RefNo, ContactPerson, Designation, CPNumber, EmailAddress FROM ${L}.dbContactPerson WHERE 1 = 1${ONLY ? " AND Refno = @param0" : ""}`, p));
  const signatories = group(await selectData(`SELECT RefNo, Signatory, Designation, CPNumber, EmailAddress FROM ${L}.dbSignatory WHERE 1 = 1${only}`, p));
  const docs = group(
    await blobQuery(
      `SELECT 'CONTRACT_ATTACHMENT' AS source, RefNo, DocName, CAST(DATALENGTH(DocID) AS BIGINT) AS size
         FROM ${L}.dbContractAttachment WHERE ${NOT_DELETED} AND DocID IS NOT NULL${only}
       UNION ALL
       SELECT 'ADDITIONAL_DOCUMENT', RefNo, DocName, CAST(DATALENGTH(DocID) AS BIGINT)
         FROM ${L}.dbAddDocs WHERE ${NOT_DELETED} AND DocID IS NOT NULL${only}`,
      p
    )
  );
  return { locators, stockholders, contacts, signatories, docs };
}

// ---------- mapping ----------

// When the legacy Type of Contract isn't a Type of Contract name here, the
// closest one (the client's File Maintenance names), if it exists.
const CONTRACT_ALIASES = {
  "LEASE AGREEMENT": ["DIRECT LEASE"],
  "SHORT-TERM LEASE AGREEMENT": ["SHORT TERM LEASE", "SHORT-TERM LEASE"],
  "APPROVAL OF SUBLEASE AGREEMENT": ["SUBLEASE AGREEMENT"],
  "CONFIRMATION OF SUBLEASE AGREEMENT": ["SUBLEASE AGREEMENT"],
  "SUBLEASE AGREEMENT": ["SUBLEASE AGREEMENT"],
};
const isSublease = (tocText) => /SUB-?LEASE/i.test(String(tocText || ""));

function resolveContractType(tocText, lk) {
  if (!tocText) return null;
  const exact = lk.contractTypes.get(upperKey(tocText));
  if (exact) return exact;
  for (const name of CONTRACT_ALIASES[upperKey(tocText)] || []) {
    const id = lk.contractTypes.get(upperKey(name));
    if (id) return id;
  }
  return null;
}

/** Industry Type: the legacy Industry when it's a name here; otherwise (the
 * client's Industry Types are lease kinds — Direct Lease / Sublease) the one
 * that fits the legacy Type of Contract. */
function resolveIndustry(industryText, tocText, lk) {
  if (industryText) {
    const exact = lk.industries.get(upperKey(industryText));
    if (exact) return { code: exact, fromContract: false };
  }
  if (!tocText) return { code: null, fromContract: false };
  const names = isSublease(tocText) ? ["SUBLEASE", "SUB-LEASE"] : ["DIRECT LEASE"];
  for (const name of names) {
    const code = lk.industries.get(upperKey(name));
    if (code) return { code, fromContract: true };
  }
  return { code: null, fromContract: false };
}

function mapLocator(row, lk) {
  const officerName = txt(row.AccountOfficer);
  const officerId = officerName && !NO_OFFICERS ? findOfficer(officerName, lk) : null;
  const industryText = txt(row.Industry);
  const tocText = txt(row.TypeContract);
  const landUseText = txt(row.LandUse, 500);
  const industry = resolveIndustry(industryText, tocText, lk);
  // A legacy industry that isn't an Industry Type here (e.g. MANUFACTURING)
  // is kept on the record, at the end of Business Activities.
  const legacyIndustryNote = industryText && (industry.fromContract || !industry.code) ? `Industry (BRIDGE): ${industryText}` : null;
  const activities = [txt(row.BusinessType), legacyIndustryNote].filter(Boolean).join("\n\n") || null;
  const ids = secAndTin(row);
  return {
    refNo: String(row.RefNo).trim(),
    businessName: cleanName(row.Tenant) || `Legacy Locator ${row.RefNo}`,
    secNo: ids.sec,
    tin: ids.tin,
    officerName,
    officerId,
    industryText,
    industryCode: industry.code,
    industryFromContract: industry.fromContract,
    activities,
    tocText,
    contractTypeId: resolveContractType(tocText, lk),
    landUseText,
    landUseId: landUseText ? lk.landUses.get(upperKey(landUseText)) ?? null : null,
    createdBy: lk.usersByName.get(upperKey(row.EncodedBy)) ?? lk.adminId,
    start: ymd(row.StartTerm),
    end: ymd(row.EndTerm),
  };
}


// ---------- renewals → one locator ----------
//
// BRIDGE kept every renewal / extension / amendment as its own row; here a
// locator is one company and its renewals are Lease Agreements history (one
// current lease). Rows of the same company are chained into one locator:
//   - "RENEWAL" / "EXTENSION" in the name → after the lease that ended just
//     before it starts;
//   - "AMENDMENT" → onto the lease it overlaps (same (A)/(B)… label);
//   - no marker, starting the day the previous lease ended → its renewal.
// Anything else — leases running side by side (other buildings, billboards,
// (A)/(B)/(C) leases) — is a locator of its own.

const DAY = 86400000;
const toTime = (d) => (d ? new Date(`${d}T00:00:00Z`).getTime() : null);
const SUFFIX_WORDS = new Set(["INC", "CORP", "CORPORATION", "PHILS", "PHIL", "PHILIPPINES", "CO", "LTD", "LLC", "THE", "OF"]);
/** The company part of a legacy Tenant ("SONIMETRIX, INC. (3RD RENEWAL)" → "SONIMETRIX"). */
function companyKey(tenant) {
  return String(tenant || "")
    .toUpperCase()
    .replace(/\(.*$/, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !SUFFIX_WORDS.has(w))
    .join(" ");
}
const MARKER = /\(([^)]*\b(RENEWAL|EXTENSION|AMENDMENT|AMEND|LETTER AMENDMENT)\b[^)]*)\)?/gi;
/** The locator's name without the lease markers ("… (3RD RENEWAL)"). */
function cleanName(tenant) {
  const s = String(tenant || "")
    .replace(MARKER, "")
    .replace(/\s+(\d+(ST|ND|RD|TH)\s+)?(LETTER\s+)?(RENEWAL|EXTENSION|AMENDMENT)\b[^()]*$/i, "") // a bare trailing marker
    .replace(/\s+/g, " ")
    .replace(/[\s,]+$/, "")
    .trim();
  return s ? s.slice(0, 255) : null;
}
function leaseKind(tenant) {
  const s = String(tenant || "").toUpperCase();
  if (/AMEND/.test(s)) return "amend";
  if (/RENEWAL|EXTENSION/.test(s)) return "renewal";
  return "";
}
const leaseLabel = (tenant) => (String(tenant || "").toUpperCase().match(/\(([A-E])\)/) || [])[1] || "";
const tinKey = (v) => String(v || "").replace(/\D/g, "").slice(0, 9) || null;
const looksTin = (v) => /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/.test(String(v || "").trim());
const looksSec = (v) => /^[A-Z]{1,3}\d{4}-?\d{3,7}$|^\d{10}$/i.test(String(v || "").trim());
/** BRIDGE's RefCode is the SEC Registration No.; a few rows have it and the TIN swapped. */
function secAndTin(row) {
  let sec = txt(row.RefCode, 100);
  let tin = txt(row.TINNo);
  if (sec && tin && looksTin(sec) && looksSec(tin)) [sec, tin] = [tin, sec];
  if (sec && !looksSec(sec)) sec = null; // "213", a TIN, … — not an SEC number
  return { sec: sec ? sec.toUpperCase() : null, tin };
}

/** The legacy rows grouped into chains (oldest lease first; the last is current). */
function buildChains(rows) {
  const info = (r) => ({
    row: r,
    start: toTime(ymd(r.StartTerm)),
    end: toTime(ymd(r.EndTerm)),
    signed: toTime(ymd(r.SignedDT)) ?? 0,
    kind: leaseKind(r.Tenant),
    label: leaseLabel(r.Tenant),
    tin: tinKey(secAndTin(r).tin),
  });
  const byCompany = new Map();
  for (const r of rows) {
    const k = companyKey(r.Tenant) || `#${r.RefNo}`;
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(info(r));
  }
  const chains = [];
  for (const items of byCompany.values()) {
    const own = [];
    const tail = (c) => c[c.length - 1];
    const labelOk = (c, x) => !x.label || c.every((y) => !y.label || y.label === x.label);
    const tinOf = (c) => new Set(c.map((y) => y.tin).filter(Boolean));
    const pick = (cands, x) =>
      cands.sort(
        (a, b) =>
          Number(tinOf(b).has(x.tin)) - Number(tinOf(a).has(x.tin)) ||
          (tail(b).end ?? 0) - (tail(a).end ?? 0) ||
          b.length - a.length
      )[0];
    const startOrder = (a, b) =>
      (a.start ?? 0) - (b.start ?? 0) || Number(!a.kind) - Number(!b.kind) || a.signed - b.signed;
    // Renewals and plain leases by start date; amendments afterwards, by date signed.
    const firstPass = items.filter((x) => x.kind !== "amend").sort(startOrder);
    const amendments = items.filter((x) => x.kind === "amend").sort((a, b) => a.signed - b.signed || (a.start ?? 0) - (b.start ?? 0));
    for (const x of [...firstPass, ...amendments]) {
      let cands = [];
      if (x.start != null) {
        if (x.kind === "amend") {
          cands = own.filter((c) => {
            const y = tail(c);
            return labelOk(c, x) && y.start != null && y.end != null && x.end != null && y.start <= x.end && x.start <= y.end;
          });
        } else if (x.kind === "renewal") {
          cands = own.filter((c) => {
            const y = tail(c);
            return labelOk(c, x) && y.end != null && y.start < x.start && y.end <= x.start + 31 * DAY;
          });
        } else {
          cands = own.filter((c) => {
            const y = tail(c);
            const tins = tinOf(c);
            return (
              labelOk(c, x) && y.end != null && x.start - y.end >= 0 && x.start - y.end <= DAY &&
              (!x.tin || !tins.size || tins.has(x.tin))
            );
          });
        }
      }
      const into = cands.length ? pick(cands, x) : null;
      if (into) into.push(x);
      else own.push([x]);
    }
    chains.push(...own);
  }
  return chains.map((c) => c.map((x) => x.row));
}

/** The latest row of the chain that has something for `has` (else the current row). */
const latestWith = (chain, has) => [...chain].reverse().find(has) || chain[chain.length - 1];

// The dbo.proponents columns a legacy locator fills (ref_no aside) — one
// source for the import and --resync. TIN is plain here (encrypted on write).
function profileValues(row, m) {
  return {
    business_name: m.businessName,
    // BRIDGE's RefCode (an SEC number for most) is both: the SEC Registration
    // No. and, as is, the Ref. Code of the current lease (see planChains).
    ref_code: m.refCode ?? null,
    registration_no: m.secNo ?? null,
    tin: m.tin ?? null,
    address: txt(row.Address, 1000),
    lease_address: txt(row.ActualAddress, 1000),
    location: txt(row.Location, 500),
    business_activities: m.activities,
    industry_code: m.industryCode,
    contract_type_id: m.contractTypeId,
    land_use: m.landUseText,
    land_use_id: m.landUseId,
    account_officer_id: m.officerId,
    sec_registration_date: ymd(row.SecReg),
    date_signed: ymd(row.SignedDT),
    grace_period: txt(row.GracePeriod, 100),
    is_sublease: sublease(row.SubLeased),
    sub_pgro: txt(row.SubPGRO, 50),
    sub_pgrr: txt(row.SubPGRR, 50),
    extension_remarks: txt(row.Extension, 1000),
    authorized_capital: txt(row.CapitalStock, 100),
    authorized_capital_currency: currency(row.ACSCurrency),
    subscribed_capital: txt(row.SubscribedCapital, 100),
    subscribed_capital_currency: currency(row.SCCurrency),
    paid_up_capital: txt(row.PaidUpCapital, 100),
    paid_up_capital_currency: currency(row.PCCurrency),
    manual_start_term: m.start,
    manual_end_term: m.end,
    created_by: m.createdBy,
  };
}
const dbValue = (col, v) => (col === "tin" && v ? encryptValue(v) : v);

const stockholderRows = (rows) =>
  rows.map((s) => ({
    name: txt(s.StockName, 255),
    nationality: txt(s.Nationality, 100),
    subscribed: money(s.Subcribed),
    paid: money(s.Paid),
    ownership: money(s.Ownership),
  }));
const personRows = (rows, nameKey) =>
  rows.map((r) => ({
    name: txt(r[nameKey], 255),
    designation: txt(r.Designation, 255),
    contact_no: txt(r.CPNumber, 100),
    email: txt(r.EmailAddress, 255),
  }));
const financialFields = (row) => ({
  advance_lease_payment_months: txt(row.ALPPerMonth, 100),
  advance_lease_payment_amount: txt(row.ALPAmount1, 100),
  advance_lease_payment_currency: currency(row.ALPCurrency),
  security_deposit_months: txt(row.SDPerMonth, 100),
  security_deposit_amount: txt(row.SDAmount1, 100),
  security_deposit_currency: currency(row.SDCurrency),
  performance_security_months: txt(row.PSPerMonth, 100),
  performance_security_amount: txt(row.PSAmount1, 100),
  performance_security_currency: currency(row.PSCurrency),
});
const investmentFields = (row) => ({
  investment_commitment: txt(row.InvestmentCommit, 100),
  investment_actual: txt(row.InvestmentActual, 100),
  employee_commitment: txt(row.EmployeeCommit, 100),
  employee_actual: txt(row.EmployeeActual, 100),
});

// ---------- import ----------

/** A chain's stockholders / contacts / signatories: from the latest of its
 * rows that has any (BRIDGE often left them on the first row only). */
function chainKids(chain, legacy) {
  const get = (map, r) => map.get(String(r.RefNo).trim()) || [];
  const latest = (map) => get(map, latestWith(chain, (r) => get(map, r).length > 0));
  return { stockholders: latest(legacy.stockholders), contacts: latest(legacy.contacts), signatories: latest(legacy.signatories) };
}
const filled = (obj) => Object.values(obj).some((v) => v !== null && v !== undefined && v !== "");
const finRow = (chain) => latestWith(chain, (r) => filled(financialFields(r)));
const invRow = (chain) => latestWith(chain, (r) => filled(investmentFields(r)));

/** One locator for a chain: the profile from its current (last) row, one
 * Lease Agreement per row (the last current, the rest history), each with its
 * building details as its property schedule. */
async function createLocator(chain, m, kids, actorId, lk, refCodes) {
  const row = chain[chain.length - 1];
  return runInTransaction(async (tx) => {
    const values = profileValues(row, m);
    const cols = Object.keys(values);
    const inserted = await tx.query(
      `
      INSERT INTO dbo.proponents
        (user_id, ref_no, ${cols.join(", ")},
         is_manual_registration, is_active, created_at, updated_at, legacy_imported_at)
      OUTPUT INSERTED.id
      VALUES
        (NULL, @param0, ${cols.map((_, i) => `@param${i + 1}`).join(", ")},
         1, 1, @param${cols.length + 1}, @param${cols.length + 2}, SYSUTCDATETIME())
      `,
      [m.refNo, ...cols.map((c) => dbValue(c, values[c])), chain[0].EncodedDT || new Date(), row.EditedDT || null]
    );
    const id = inserted?.recordset?.[0]?.id;
    if (!id) throw new Error("insert returned no id");

    await Stockholder.syncForProponent(tx, id, stockholderRows(kids.stockholders), actorId);
    await ContactPerson.syncForProponent(tx, id, personRows(kids.contacts, "ContactPerson"), actorId);
    await Signatory.syncForProponent(tx, id, personRows(kids.signatories, "Signatory"), actorId);
    await FinancialTerms.upsertForProponent(tx, id, financialFields(finRow(chain)), actorId);
    await Investment.upsertForProponent(tx, id, investmentFields(invRow(chain)), actorId);

    for (let i = 0; i < chain.length; i += 1) {
      const r = chain[i];
      const current = i === chain.length - 1;
      const start = ymd(r.StartTerm);
      const end = ymd(r.EndTerm);
      const lease = await tx.query(
        `INSERT INTO dbo.proponent_leases (proponent_id, ref_code, contract_type_id, date_signed, start_term, end_term, is_current, created_by)
         OUTPUT INSERTED.id
         VALUES (@param0, @param7, @param1, @param2, @param3, @param4, @param5, @param6)`,
        [id, resolveContractType(txt(r.TypeContract), lk), ymd(r.SignedDT), start, end, current ? 1 : 0, actorId, refCodes.get(String(r.RefNo).trim()) ?? null]
      );
      const leaseId = lease?.recordset?.[0]?.id ?? null;
      if (txt(r.BuildingDetails)) {
        await tx.query(
          `INSERT INTO dbo.proponent_properties (proponent_id, lease_id, sort_order, type_of_property, date_from, date_to, rate_currency, mgl_currency, created_at)
           VALUES (@param0, @param1, 1, @param2, @param3, @param4, 'PHP', 'PHP', SYSUTCDATETIME())`,
          [id, leaseId, txt(r.BuildingDetails, 255), start, end]
        );
      }
      await tx.query(
        `INSERT INTO dbo.legacy_import_map (legacy_ref_no, proponent_id, lease_id) VALUES (@param0, @param1, @param2)`,
        [String(r.RefNo).trim(), id, leaseId]
      );
    }
    return id;
  });
}

/** The lease term on Renewal Tracking (same as a locator encoded by hand). */
async function createLeasePermit(proponentId, m, actorId) {
  if (!m.end) return false;
  const existing = (await Permit.listByProponent(proponentId)).find((x) => x.permit_type === "CONTRACT" && !x.application_id);
  if (existing) return false;
  await Permit.create({
    proponent_id: proponentId,
    application_id: null,
    permit_type: "CONTRACT",
    permit_no: `LEASE-${m.refNo}`,
    issuing_authority: "CIAC",
    issue_date: m.start,
    expiry_date: m.end,
    remarks: "Lease term imported from the legacy BRIDGE system",
    created_by: actorId,
  });
  return true;
}

/** Writes the locator's legacy files into locators/<Ref No>/documents/. */
async function importDocuments(proponentId, refNo, actorId) {
  const tracked = new Set(
    (await selectData(`SELECT sha1 FROM dbo.legacy_import_files WHERE proponent_id = @param0`, [proponentId])).map((r) => r.sha1)
  );
  let added = 0;
  let bytes = 0;
  for (const [source, table] of [
    ["CONTRACT_ATTACHMENT", "dbContractAttachment"],
    ["ADDITIONAL_DOCUMENT", "dbAddDocs"],
  ]) {
    const rows = await blobQuery(
      `SELECT DocName, DocID FROM ${L}.${table} WHERE ${NOT_DELETED} AND DocID IS NOT NULL AND RefNo = @param0`,
      [refNo]
    );
    if (!rows.length) continue;
    const dir = await locatorDir(proponentId, "documents");
    if (!dir) throw new Error("locator folder could not be created");
    for (const r of rows) {
      const buf = Buffer.isBuffer(r.DocID) ? r.DocID : Buffer.from(r.DocID || []);
      if (!buf.length) continue;
      const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
      if (tracked.has(sha1)) continue; // already imported (or the same file twice)
      const { ext, type } = sniff(buf);
      const fileName = `${crypto.randomUUID()}${ext}`;
      const abs = path.join(dir, fileName);
      fs.writeFileSync(abs, buf);
      try {
        const doc = await ProponentDocument.create({
          proponent_id: proponentId,
          requirement_id: null,
          document_name: txt(r.DocName, 255) || "Legacy document",
          file_name: fileName,
          original_file_name: `${safeFileName(r.DocName)}${ext}`,
          storage_path: relativeStoragePath(abs),
          content_type: type,
          file_size_bytes: buf.length,
          created_by: actorId,
        });
        await updateData(
          `INSERT INTO dbo.legacy_import_files (proponent_id, ref_no, source, doc_name, sha1, proponent_document_id)
           VALUES (@param0, @param1, @param2, @param3, @param4, @param5)`,
          [proponentId, refNo, source, txt(r.DocName, 400), sha1, doc?.id ?? null]
        );
      } catch (error) {
        fs.unlink(abs, () => {});
        throw error;
      }
      tracked.add(sha1);
      added += 1;
      bytes += buf.length;
    }
  }
  return { added, bytes };
}

/** legacy Ref No → proponent id, for rows this import already brought in. */
async function importedMap() {
  const exists = (await selectData(`SELECT OBJECT_ID('dbo.legacy_import_map', 'U') AS id`))?.[0]?.id;
  if (!exists) return new Map();
  const rows = await selectData(`SELECT legacy_ref_no, proponent_id FROM dbo.legacy_import_map`);
  return new Map(rows.map((r) => [String(r.legacy_ref_no), r.proponent_id]));
}

/** The chains with their mapping, SEC numbers kept unique (one company, one
 * number): a company split over several locators (leases side by side) keeps
 * it on the one with the most leases / the latest end; the others are listed. */
function planChains(legacy, lk) {
  const chains = buildChains(legacy.locators);
  const plans = chains.map((chain) => {
    const row = chain[chain.length - 1];
    const m = mapLocator(row, lk);
    // SEC No. / TIN: the latest row that has one.
    m.secNo = secAndTin(latestWith(chain, (r) => secAndTin(r).sec)).sec;
    m.tin = m.tin || secAndTin(latestWith(chain, (r) => secAndTin(r).tin)).tin;
    return { chain, row, m };
  });
  const order = [...plans].sort(
    (a, b) => b.chain.length - a.chain.length || String(ymd(b.row.EndTerm) || "").localeCompare(String(ymd(a.row.EndTerm) || ""))
  );
  const taken = new Map();
  const secDropped = [];
  for (const p of order) {
    const sec = p.m.secNo;
    if (!sec) continue;
    if (taken.has(sec)) {
      secDropped.push(`${p.m.refNo} ${p.m.businessName} (SEC ${sec} is on ${taken.get(sec)})`);
      p.m.secNo = null;
    } else taken.set(sec, `${p.m.refNo} ${p.m.businessName}`);
  }
  // Ref. Code per lease = BRIDGE's RefCode as is. A Ref. Code is never used
  // twice (not even within a locator's own history), so where BRIDGE repeats
  // one, current leases get it first, then earlier leases newest first.
  const refCodes = new Map();
  const codeTaken = new Map();
  const codeDropped = [];
  const entries = [
    ...order.map((p) => ({ p, r: p.chain[p.chain.length - 1] })),
    ...order.flatMap((p) => [...p.chain].reverse().slice(1).map((r) => ({ p, r }))),
  ];
  for (const { p, r } of entries) {
    const code = txt(r.RefCode, 50);
    if (!code) continue;
    const key = code.toUpperCase();
    if (codeTaken.has(key)) {
      codeDropped.push(`${String(r.RefNo).trim()} (${p.m.businessName}): "${code}" is on ${codeTaken.get(key)}`);
      continue;
    }
    codeTaken.set(key, `${String(r.RefNo).trim()} ${p.m.businessName}`);
    refCodes.set(String(r.RefNo).trim(), code);
  }
  for (const p of plans) p.m.refCode = refCodes.get(p.m.refNo) ?? null;
  return { plans, secDropped, refCodes, codeDropped };
}

async function runImport() {
  if (APPLY) {
    // The app's own tables (normally created by the backend on start).
    for (const mod of [Proponent, Stockholder, ContactPerson, Signatory, FinancialTerms, Investment, ProponentDocument]) await mod.ensureSchema();
    await require("../models/ProponentLease").ensureSchema();
    await ensureImportSchema();
  }
  const lk = await loadLookups();
  const legacy = await loadLegacy();
  const { plans, secDropped, refCodes, codeDropped } = planChains(legacy, lk);
  const imported = await importedMap();
  const refNos = legacy.locators.map((r) => String(r.RefNo).trim());
  const inApp = new Set();
  for (let i = 0; i < refNos.length; i += 500) {
    const part = refNos.slice(i, i + 500);
    const rows = await selectData(
      `SELECT ref_no FROM dbo.proponents WHERE ref_no IN (${part.map((_, j) => `@param${j}`).join(", ")})`,
      part
    );
    rows.forEach((r) => inApp.add(String(r.ref_no)));
  }

  console.log(`${APPLY ? "IMPORTING" : "DRY RUN — nothing is written (add --apply)"} from ${LEGACY_DB}${ONLY ? `, Ref No ${ONLY}` : ""}`);
  console.log(`Legacy rows (not deleted): ${legacy.locators.length} → ${plans.length} locator(s)\n`);

  const stats = { created: 0, skippedOther: 0, resumed: 0, docs: 0, docBytes: 0, failed: 0, permits: 0, leases: 0 };
  const unmatched = { officer: new Map(), industry: new Map(), contractType: new Map() };
  const fromContract = new Map();
  const bump = (map, k) => k && map.set(k, (map.get(k) || 0) + 1);
  let plannedDocs = 0;
  let plannedBytes = 0;
  const children = { stockholders: 0, contacts: 0, signatories: 0, withEmail: 0 };
  const merged = [];

  for (const { chain, row, m } of plans) {
    const kids = chainKids(chain, legacy);
    const docs = chain.flatMap((r) => legacy.docs.get(String(r.RefNo).trim()) || []);
    if (m.officerName && !m.officerId && !NO_OFFICERS) bump(unmatched.officer, m.officerName);
    if (!m.industryCode) bump(unmatched.industry, m.industryText || "(blank)");
    if (m.industryFromContract) bump(fromContract, `${m.tocText} → ${[...lk.industries.entries()].find(([, c]) => c === m.industryCode)?.[0]}`);
    for (const r of chain) if (txt(r.TypeContract) && !resolveContractType(txt(r.TypeContract), lk)) bump(unmatched.contractType, txt(r.TypeContract));
    if (chain.length > 1) {
      merged.push(
        `  ${m.refNo} ${m.businessName}: ` +
          chain.map((r) => `${String(r.RefNo).trim()} (${ymd(r.StartTerm) || "?"} → ${ymd(r.EndTerm) || "?"})`).join(" ⇒ ")
      );
    }

    const importedId = chain.map((r) => imported.get(String(r.RefNo).trim())).find(Boolean) || null;
    if (!importedId && chain.some((r) => inApp.has(String(r.RefNo).trim()))) {
      stats.skippedOther += 1;
      console.log(`- ${m.refNo} ${m.businessName}: already in the app (not from this import) — left alone`);
      continue;
    }
    plannedDocs += docs.length;
    plannedBytes += docs.reduce((sum, d) => sum + Number(d.size || 0), 0);
    children.stockholders += kids.stockholders.length;
    children.contacts += kids.contacts.length;
    children.signatories += kids.signatories.length;
    children.withEmail += [...kids.contacts, ...kids.signatories].filter((c) => /@/.test(String(c.EmailAddress || ""))).length;

    if (!APPLY) continue;
    try {
      let id = importedId;
      if (!id) {
        id = await createLocator(chain, m, kids, m.createdBy, lk, refCodes);
        stats.created += 1;
        stats.leases += chain.length;
        if (await createLeasePermit(id, m, m.createdBy)) stats.permits += 1;
      } else {
        stats.resumed += 1;
      }
      let docNote = "";
      if (!SKIP_DOCS && docs.length) {
        for (const r of chain) {
          const res = await importDocuments(id, String(r.RefNo).trim(), m.createdBy);
          stats.docs += res.added;
          stats.docBytes += res.bytes;
        }
        docNote = ` | documents done`;
      }
      console.log(
        `${importedId ? "~" : "+"} ${m.refNo} ${m.businessName}${chain.length > 1 ? ` [${chain.length} leases]` : ""}${m.officerId ? "" : " (no Account Officer)"} | ` +
          `${kids.stockholders.length} stockholder(s), ${kids.contacts.length} contact(s), ${kids.signatories.length} signator${kids.signatories.length === 1 ? "y" : "ies"}${docNote}`
      );
    } catch (error) {
      stats.failed += 1;
      console.error(`! ${m.refNo} ${m.businessName}: FAILED — ${error.message}`);
    }
  }

  const list = (map) => [...map.entries()].map(([k, n]) => `"${k}" (${n})`).join(", ") || "none";
  console.log("\n================ Summary ================");
  console.log(`Renewals / amendments merged into one locator (${merged.length}):\n${merged.join("\n") || "  none"}`);
  // Same company, same lease dates, not merged: billboards / lots side by side,
  // or the same lease encoded twice in BRIDGE — worth a look.
  const sameDates = new Map();
  for (const { row, m } of plans) {
    const k = `${companyKey(row.Tenant)}|${ymd(row.StartTerm)}|${ymd(row.EndTerm)}`;
    if (!sameDates.has(k)) sameDates.set(k, []);
    sameDates.get(k).push(`${m.refNo} ${m.businessName}`);
  }
  const dupes = [...sameDates.values()].filter((v) => v.length > 1);
  console.log(`Same company and lease dates, kept as separate locators — check for duplicates (${dupes.length}):\n${dupes.map((v) => `  ${v.join("  |  ")}`).join("\n") || "  none"}`);
  console.log(`Ref. Code (BRIDGE RefCode as is) on ${refCodes.size} lease(s); left blank where BRIDGE repeats it (${codeDropped.length}):\n${codeDropped.map((x) => `  ${x}`).join("\n") || "  none"}`);
  console.log(`SEC Registration No. kept on one locator only (${secDropped.length}):\n${secDropped.map((x) => `  ${x}`).join("\n") || "  none"}`);
  if (APPLY) {
    console.log(`Created ${stats.created} locator(s) with ${stats.leases} lease(s) (+${stats.permits} lease permit(s)), resumed ${stats.resumed}, failed ${stats.failed}.`);
    console.log(`Documents imported: ${stats.docs} (${mb(stats.docBytes)})${SKIP_DOCS ? " — skipped (--skip-documents)" : ""}.`);
  } else {
    console.log(`Would create ${plans.length - stats.skippedOther} locator(s) from ${legacy.locators.length} row(s); ${stats.skippedOther} already in the app are left alone.`);
    console.log(`Stockholders ${children.stockholders}, contact persons ${children.contacts}, signatories ${children.signatories} (${children.withEmail} with an email).`);
    console.log(`Documents: ${plannedDocs} file(s), ${mb(plannedBytes)}${SKIP_DOCS ? " — would be skipped (--skip-documents)" : ""} — make sure the uploads drive has room.`);
  }
  console.log(
    NO_OFFICERS
      ? "Account Officers: none assigned (--no-officers) — assign them on Registered Locator."
      : `Account Officer names with no matching user (left unassigned): ${list(unmatched.officer)}`
  );
  console.log(`Industry Type from the Type of Contract (legacy industry kept in Business Activities): ${list(fromContract)}`);
  console.log(`Locators left without an Industry Type (set it before renewing): ${list(unmatched.industry)}`);
  console.log(`Types of contract not in Type of Contract (left blank): ${list(unmatched.contractType)}`);
  console.log("No portal logins were created — add one per locator on Registered Locator (Portal login) once its email is known.");
}

// ---------- resync ----------

/** Comparable form of a stored or mapped value ("" / null alike, dates as
 * YYYY-MM-DD, bits as 0/1, numbers as numbers). */
function norm(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) && s.length < 16 ? Number(s) : s;
}
const same = (a, b) => norm(a) === norm(b);
const show = (v) => (norm(v) === null ? "∅" : JSON.stringify(norm(v)).slice(0, 60));
const listKey = (rows, fields) => JSON.stringify(rows.map((r) => fields.map((f) => norm(r[f]))));

/**
 * Brings the locators this import created back in line with the legacy
 * database and the app's current field rules (e.g. Account Officers matched by
 * name parts). Only locators nobody has worked on since the import are
 * touched — no staff edit, no portal login, no application; the rest are
 * listed and left alone. Only values that differ are written. Documents are
 * not part of this (a plain re-run of the import adds missing ones).
 */
async function runResync() {
  if (!(await hasImportMarker())) {
    console.log("Nothing to resync: this import has never run on this database.");
    return;
  }
  const ProponentLease = require("../models/ProponentLease");
  if (APPLY) await ProponentLease.ensureSchema();
  const lk = await loadLookups();
  const legacy = await loadLegacy();
  const cols = Object.keys(profileValues({}, { start: null, end: null }));
  const current = new Map(
    (
      await selectData(`
        SELECT p.id, p.ref_no, p.user_id, p.updated_by, ${cols.map((c) => `p.${c}`).join(", ")},
               (SELECT COUNT(1) FROM dbo.applications a WHERE a.proponent_id = p.id) AS applications
        FROM dbo.proponents p WHERE p.legacy_imported_at IS NOT NULL`)
    ).map((r) => [String(r.ref_no), r])
  );

  console.log(`${APPLY ? "RESYNCING" : "DRY RUN — nothing is written (add --apply)"} from ${LEGACY_DB}${ONLY ? `, Ref No ${ONLY}` : ""}\n`);
  const stats = { changed: 0, same: 0, touched: 0, notImported: 0, failed: 0 };
  const fieldCounts = new Map();
  const unmatchedOfficers = new Map();
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

  const { plans, refCodes } = planChains(legacy, lk);
  const mapExists = (await selectData(`SELECT OBJECT_ID('dbo.legacy_import_map', 'U') AS id`))?.[0]?.id;
  for (const { chain, row, m } of plans) {
    const cur = current.get(m.refNo);
    if (!cur) {
      stats.notImported += 1;
      continue;
    }
    if (cur.updated_by || cur.user_id || Number(cur.applications) > 0) {
      stats.touched += 1;
      console.log(`- ${m.refNo} ${m.businessName}: worked on since the import — left alone`);
      continue;
    }
    if (m.officerName && !m.officerId && !NO_OFFICERS) bump(unmatchedOfficers, m.officerName);

    const want = profileValues(row, m);
    if (NO_OFFICERS) delete want.account_officer_id;
    const changes = [];
    for (const [col, v] of Object.entries(want)) {
      const have = col === "tin" ? decryptValue(cur.tin) : cur[col];
      if (!same(have, v)) changes.push({ col, from: have, to: v });
    }

    const raw = chainKids(chain, legacy);
    const kids = {
      stockholders: stockholderRows(raw.stockholders),
      contacts: personRows(raw.contacts, "ContactPerson"),
      signatories: personRows(raw.signatories, "Signatory"),
    };
    const SH = ["name", "nationality", "subscribed", "paid", "ownership"];
    const PP = ["name", "designation", "contact_no", "email"];
    const childSync = [];
    if (listKey(await Stockholder.listForProponent(cur.id), SH) !== listKey(kids.stockholders.filter((r) => r.name), SH))
      childSync.push("stockholders");
    if (listKey(await ContactPerson.listForProponent(cur.id), PP) !== listKey(kids.contacts.filter((r) => r.name), PP))
      childSync.push("contacts");
    if (listKey(await Signatory.listForProponent(cur.id), PP) !== listKey(kids.signatories.filter((r) => r.name), PP))
      childSync.push("signatories");
    const fin = financialFields(finRow(chain));
    const finHave = await FinancialTerms.getForProponent(cur.id);
    if (Object.keys(fin).some((k) => !same(finHave[k], fin[k]))) childSync.push("financial terms");
    const inv = investmentFields(invRow(chain));
    const invHave = await Investment.getForProponent(cur.id);
    if (Object.keys(inv).some((k) => !same(invHave[k], inv[k]))) childSync.push("investment");

    const building = txt(row.BuildingDetails, 255);
    // The current lease's schedule (earlier leases keep their own).
    const props = await selectData(
      `SELECT pp.id, pp.type_of_property, pp.date_from, pp.date_to FROM dbo.proponent_properties pp
       WHERE pp.proponent_id = @param0 AND pp.is_active = 1
         AND (pp.lease_id IS NULL OR pp.lease_id IN (SELECT id FROM dbo.proponent_leases WHERE proponent_id = @param0 AND is_current = 1))
       ORDER BY pp.sort_order, pp.id`,
      [cur.id]
    );
    const prop = props[0];
    const propChange =
      building && (!prop || !same(prop.type_of_property, building) || !same(prop.date_from, m.start) || !same(prop.date_to, m.end));
    if (propChange) childSync.push("building details");

    const permit = (await Permit.listByProponent(cur.id)).find((x) => x.permit_type === "CONTRACT" && !x.application_id);
    const permitChange = m.end && (!permit || !same(permit.issue_date, m.start) || !same(permit.expiry_date, m.end));
    if (permitChange) childSync.push(permit ? "lease permit dates" : "lease permit (new)");

    // Earlier leases' Ref. Codes (the current one follows the locator's ref_code).
    const historyCodes = mapExists
      ? (
          await selectData(
            `SELECT m.legacy_ref_no, l.id, l.ref_code FROM dbo.legacy_import_map m
             JOIN dbo.proponent_leases l ON l.id = m.lease_id
             WHERE m.proponent_id = @param0 AND l.is_current = 0`,
            [cur.id]
          )
        )
          .map((l) => ({ id: l.id, from: l.ref_code, to: refCodes.get(String(l.legacy_ref_no)) ?? null }))
          .filter((l) => !same(l.from, l.to))
      : [];
    if (historyCodes.length) childSync.push("earlier leases' Ref. Codes");

    if (!changes.length && !childSync.length) {
      stats.same += 1;
      continue;
    }
    stats.changed += 1;
    changes.forEach((c) => bump(fieldCounts, c.col));
    childSync.forEach((c) => bump(fieldCounts, c));
    console.log(`~ ${m.refNo} ${m.businessName}`);
    for (const c of changes) {
      const secret = c.col === "tin";
      console.log(`    ${c.col}: ${secret ? "(changed)" : `${show(c.from)} → ${show(c.to)}`}`);
    }
    if (childSync.length) console.log(`    re-synced: ${childSync.join(", ")}`);
    if (!APPLY) continue;

    try {
      await runInTransaction(async (tx) => {
        if (changes.length) {
          await tx.query(
            `UPDATE dbo.proponents SET ${changes.map((c, i) => `${c.col} = @param${i + 1}`).join(", ")}, updated_at = SYSUTCDATETIME()
             WHERE id = @param0 AND legacy_imported_at IS NOT NULL`,
            [cur.id, ...changes.map((c) => dbValue(c.col, c.to))]
          );
        }
        // Rows without ids: the active list is replaced by the legacy one.
        if (childSync.includes("stockholders")) await Stockholder.syncForProponent(tx, cur.id, kids.stockholders, m.createdBy);
        if (childSync.includes("contacts")) await ContactPerson.syncForProponent(tx, cur.id, kids.contacts, m.createdBy);
        if (childSync.includes("signatories")) await Signatory.syncForProponent(tx, cur.id, kids.signatories, m.createdBy);
        if (childSync.includes("financial terms")) await FinancialTerms.upsertForProponent(tx, cur.id, fin, m.createdBy);
        if (childSync.includes("investment")) await Investment.upsertForProponent(tx, cur.id, inv, m.createdBy);
        // The current lease row mirrors Ref. Code, Date Signed, Start/End and Type of Contract.
        await ProponentLease.syncCurrentFromProponent(tx, cur.id, null);
        for (const l of historyCodes) {
          await tx.query(`UPDATE dbo.proponent_leases SET ref_code = @param1, updated_at = GETDATE() WHERE id = @param0`, [l.id, l.to]);
        }
        if (propChange) {
          const leaseId = await ProponentLease.currentLeaseId(cur.id, tx);
          if (prop) {
            await tx.query(
              `UPDATE dbo.proponent_properties SET type_of_property = @param1, date_from = @param2, date_to = @param3, updated_at = GETDATE()
               WHERE id = @param0`,
              [prop.id, building, m.start, m.end]
            );
          } else {
            await tx.query(
              `INSERT INTO dbo.proponent_properties (proponent_id, lease_id, sort_order, type_of_property, date_from, date_to, rate_currency, mgl_currency, created_at)
               VALUES (@param0, @param1, 1, @param2, @param3, @param4, 'PHP', 'PHP', SYSUTCDATETIME())`,
              [cur.id, leaseId, building, m.start, m.end]
            );
          }
        }
      });
      if (permitChange) {
        if (permit) await Permit.update(permit.id, { issue_date: m.start, expiry_date: m.end });
        else await createLeasePermit(cur.id, m, m.createdBy);
      }
    } catch (error) {
      stats.failed += 1;
      console.error(`! ${m.refNo} ${m.businessName}: FAILED — ${error.message}`);
    }
  }

  const list = (map) => [...map.entries()].map(([k, n]) => `${k} (${n})`).join(", ") || "none";
  console.log("\n================ Summary ================");
  console.log(
    `${APPLY ? "Updated" : "Would update"} ${stats.changed - stats.failed} locator(s); ${stats.same} already in line; ` +
      `${stats.touched} worked on since the import (left alone); ${stats.notImported} not from this import; failed ${stats.failed}.`
  );
  console.log(`Changes by field: ${list(fieldCounts)}`);
  if (!NO_OFFICERS) console.log(`Account Officer names with no matching Account Officer user (left unassigned): ${list(unmatchedOfficers)}`);
}

// ---------- undo ----------

async function runRemove() {
  if (!(await hasImportMarker())) {
    console.log("Nothing to remove: this import has never run on this database.");
    return;
  }
  const rows = await selectData(
    `SELECT p.id, p.ref_no, p.business_name, p.user_id,
            (SELECT COUNT(1) FROM dbo.applications a WHERE a.proponent_id = p.id) AS applications
     FROM dbo.proponents p
     WHERE p.legacy_imported_at IS NOT NULL${ONLY ? " AND p.ref_no = @param0" : ""}
     ORDER BY p.ref_no`,
    ONLY ? [ONLY] : []
  );
  console.log(`${APPLY ? "REMOVING" : "DRY RUN — nothing is removed (add --apply)"}: ${rows.length} imported locator(s)\n`);
  let removed = 0;
  let kept = 0;
  for (const p of rows) {
    if (Number(p.applications) > 0 || p.user_id) {
      kept += 1;
      console.log(`- ${p.ref_no} ${p.business_name}: kept (${p.user_id ? "has a portal login" : "has an application/renewal"})`);
      continue;
    }
    if (!APPLY) {
      removed += 1;
      continue;
    }
    try {
      const files = await selectData(`SELECT storage_path FROM dbo.proponent_documents WHERE proponent_id = @param0`, [p.id]);
      await runInTransaction(async (tx) => {
        const tables = [
          "legacy_import_map",
          "legacy_import_files",
          "proponent_documents",
          "permits",
          "stockholder",
          "contact_person",
          "signatory",
          "proponent_financial_terms",
          "proponent_investment",
          "proponent_properties",
          "locator_compliance_documents",
          "locator_compliance_items",
          "proponent_profile_change_requests",
          "proponent_extensions",
          "proponent_leases",
        ];
        for (const t of tables) {
          await tx.query(
            `IF OBJECT_ID('dbo.${t}', 'U') IS NOT NULL DELETE FROM dbo.${t} WHERE proponent_id = @param0`,
            [p.id]
          );
        }
        await tx.query(`DELETE FROM dbo.proponents WHERE id = @param0 AND legacy_imported_at IS NOT NULL`, [p.id]);
      });
      for (const f of files) {
        const abs = resolveStoredPath(f.storage_path);
        if (abs) fs.unlink(abs, () => {});
      }
      removed += 1;
      console.log(`x ${p.ref_no} ${p.business_name}: removed (${files.length} file(s))`);
    } catch (error) {
      kept += 1;
      console.error(`! ${p.ref_no} ${p.business_name}: could not remove — ${error.message}`);
    }
  }
  console.log(`\n${APPLY ? "Removed" : "Would remove"} ${removed}; kept ${kept}.`);
}

(REMOVE ? runRemove() : RESYNC ? runResync() : runImport())
  .then(async () => {
    if (blobPool) await blobPool.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error("Legacy import failed:", error.message || error);
    process.exit(1);
  });
