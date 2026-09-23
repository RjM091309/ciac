const { selectData, insertData, updateData, updateSchema, runInTransaction } = require("../config/database");
const { encryptValue, decryptValue } = require("../lib/crypto");
const TypeOfContract = require("./TypeOfContract");
const LandUse = require("./LandUse");

// Stockholder / ContactPerson require this module (for their FK), so they are loaded on
// first use instead of at the top to avoid a circular require.
const Stockholder = () => require("./Stockholder");
const ContactPerson = () => require("./ContactPerson");
const Signatory = () => require("./Signatory");
const FinancialTerms = () => require("./FinancialTerms");
const Investment = () => require("./Investment");

function toInt(v) {
  if (v === null || v === undefined || v === "") return null; // Number(null) is 0, not "no value"
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const ENC_PREFIX = "enc:v1:";
let tinMigrationRan = false;

/** One-time, idempotent: encrypts any TIN values written before this column
 * became encrypted-at-rest. decryptValue already tolerates plaintext rows
 * (returns them as-is), so this only matters for actually protecting
 * existing data, not for correctness of reads. */
async function migrateLegacyPlaintextTin() {
  if (tinMigrationRan) return;
  tinMigrationRan = true;
  try {
    const rows = await selectData(
      `SELECT id, tin FROM dbo.proponents WHERE tin IS NOT NULL AND tin <> '' AND tin NOT LIKE '${ENC_PREFIX}%'`
    );
    for (const row of rows) {
      await updateData(`UPDATE dbo.proponents SET tin = @param1 WHERE id = @param0`, [row.id, encryptValue(row.tin)]);
    }
  } catch (error) {
    console.error("TIN encryption migration failed:", error);
  }
}

/** Server-authoritative locator reference number: LOC-YYYY-00001, incrementing
 * per year. Reuses the same counter table as generateApplicationNo
 * (ApplicationWorkflow.js) under a distinct "LOC-{year}" key so concurrent
 * locator creations never race onto the same number. */
async function generateLocatorRefNo(tx) {
  const year = new Date().getFullYear();
  const counterKey = `LOC-${year}`;

  const result = await tx.query(
    `
    MERGE dbo.application_no_counters WITH (HOLDLOCK) AS target
    USING (SELECT @param0 AS counter_key) AS src
    ON target.counter_key = src.counter_key
    WHEN MATCHED THEN UPDATE SET last_value = target.last_value + 1
    WHEN NOT MATCHED THEN INSERT (counter_key, last_value) VALUES (src.counter_key, 1)
    OUTPUT INSERTED.last_value;
    `,
    [counterKey]
  );
  const seq = result?.recordset?.[0]?.last_value || 1;
  return `${counterKey}-${String(seq).padStart(5, "0")}`;
}

/** Formats a start/end date pair as "<years>Y-<months>M-<days>D", derived at
 * read time from the actual contract dates so it can never drift out of sync
 * with what was really issued. Returns null if either date is missing. */
function formatLeaseTerm(start, end) {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null;

  let years = e.getFullYear() - s.getFullYear();
  let months = e.getMonth() - s.getMonth();
  let days = e.getDate() - s.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(e.getFullYear(), e.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years}Y-${months}M-${days}D`;
}

let refNoBackfillRan = false;

/** One-time, idempotent: assigns a ref_no to any proponent rows created
 * before this column existed, so the Locators List always has a stable
 * reference number to show. */
async function backfillMissingRefNos() {
  if (refNoBackfillRan) return;
  refNoBackfillRan = true;
  try {
    const rows = await selectData(
      `SELECT id FROM dbo.proponents WHERE ref_no IS NULL ORDER BY id ASC`
    );
    for (const row of rows) {
      await runInTransaction(async (tx) => {
        const refNo = await generateLocatorRefNo(tx);
        await tx.query(`UPDATE dbo.proponents SET ref_no = @param1 WHERE id = @param0`, [row.id, refNo]);
      });
    }
  } catch (error) {
    console.error("Locator ref_no backfill failed:", error);
  }
}

async function ensureSchema() {
  // getProponentById joins dbo.type_of_contract for the Type of Contract name.
  await TypeOfContract.ensureSchema();
  await updateSchema(`
    IF OBJECT_ID('dbo.proponents', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponents (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NULL,
        business_name NVARCHAR(255) NOT NULL,
        registration_no NVARCHAR(100) NULL,
        tin NVARCHAR(50) NULL,
        address NVARCHAR(500) NULL,
        contact_no NVARCHAR(100) NULL,
        ref_no NVARCHAR(30) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponents_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_proponents_is_active DEFAULT (1),
        CONSTRAINT FK_proponents_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
      );

      CREATE INDEX IX_proponents_user_id ON dbo.proponents(user_id);
      CREATE INDEX IX_proponents_business_name ON dbo.proponents(business_name);
    END
  `);
  // AES-256-GCM ciphertext (iv + tag + data, base64) plus the "enc:v1:"
  // prefix comfortably exceeds the original plaintext-only NVARCHAR(50).
  await updateSchema(`
    IF EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.proponents') AND name = 'tin' AND max_length < 510
    )
      ALTER TABLE dbo.proponents ALTER COLUMN tin NVARCHAR(255) NULL;
  `);
  await updateSchema(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'proponents' AND COLUMN_NAME = 'ref_no'
    )
      ALTER TABLE dbo.proponents ADD ref_no NVARCHAR(30) NULL;
  `);
  // Distinct from `address` (the full mailing address) — a short
  // zone/building label (e.g. "G PUYAT", "BERTAPHIL V"). Shown on the
  // per-locator detail/edit panel only, never in the Locators List table.
  await updateSchema(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'proponents' AND COLUMN_NAME = 'location'
    )
      ALTER TABLE dbo.proponents ADD location NVARCHAR(255) NULL;
  `);
  // "Profile" fields mirroring the legacy BRIDGE system's Locator's
  // Information form — like `location`, these are detail/edit-panel-only
  // (never bulk-fetched for the Locators List table).
  await updateSchema(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'proponents' AND COLUMN_NAME = 'ref_code'
    )
      ALTER TABLE dbo.proponents ADD
        ref_code NVARCHAR(50) NULL,
        lease_address NVARCHAR(500) NULL,
        account_officer_id INT NULL,
        sec_registration_date DATE NULL,
        date_signed DATE NULL,
        grace_period NVARCHAR(50) NULL,
        is_sublease BIT NULL,
        sub_pgro NVARCHAR(50) NULL,
        sub_pgrr NVARCHAR(50) NULL,
        land_use NVARCHAR(500) NULL,
        extension_date DATE NULL,
        extension_remarks NVARCHAR(300) NULL,
        authorized_capital NVARCHAR(50) NULL,
        authorized_capital_currency NVARCHAR(10) NULL,
        subscribed_capital NVARCHAR(50) NULL,
        subscribed_capital_currency NVARCHAR(10) NULL,
        paid_up_capital NVARCHAR(50) NULL,
        paid_up_capital_currency NVARCHAR(10) NULL,
        CONSTRAINT FK_proponents_account_officer FOREIGN KEY (account_officer_id) REFERENCES dbo.users(id);
  `);
  // Rest of the legacy BRIDGE "Profile" tab: business activities free text.
  // The three Months MGL/Amount/Currency blocks (Advance Lease Payment,
  // Security Deposit, Performance Security) used to be nine columns here too
  // — they now live in dbo.proponent_financial_terms instead (see
  // FinancialTerms.js), one row per category instead of three columns each,
  // so a future fourth category doesn't need new columns on this table.
  await updateSchema(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'proponents' AND COLUMN_NAME = 'business_activities'
    )
      ALTER TABLE dbo.proponents ADD business_activities NVARCHAR(MAX) NULL;
  `);
  // The legacy "Profile" tab's property schedule table (No./Year/Date
  // From--To/Type of Property/Area/Rate/MGL, add-a-row via the +/- buttons)
  // — a real one-to-many child table, not columns on proponents, since a
  // locator can list any number of properties.
  await updateSchema(`
    IF OBJECT_ID('dbo.proponent_properties', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponent_properties (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        sort_order INT NOT NULL CONSTRAINT DF_proponent_properties_sort_order DEFAULT (0),
        year NVARCHAR(10) NULL,
        date_from DATE NULL,
        date_to DATE NULL,
        type_of_property NVARCHAR(255) NULL,
        area_sqm NVARCHAR(50) NULL,
        rate_sqm_mo NVARCHAR(50) NULL,
        rate_currency NVARCHAR(10) NULL,
        mgl_mo NVARCHAR(50) NULL,
        mgl_currency NVARCHAR(10) NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_properties_created_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_proponent_properties_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id) ON DELETE CASCADE
      );
      CREATE INDEX IX_proponent_properties_proponent_id ON dbo.proponent_properties(proponent_id);
    END
  `);
  await ensureLookupLinks();
  await migrateLegacyPlaintextTin();
  await backfillMissingRefNos();
}

let lookupLinksEnsured = false;

async function proponentColumnExists(name) {
  const rows = await selectData(`SELECT COL_LENGTH('dbo.proponents', @param0) AS l`, [name]);
  return rows?.[0]?.l !== null && rows?.[0]?.l !== undefined;
}

/** proponents.land_use_id -> dbo.land_use(id) (File Maintenance > Land Use). Once per
 * process. The old free-text proponents.land_use column is left untouched — the locator
 * form shows it as a read-only "Legacy" note. (Industry is not linked here: it keeps
 * coming from the locator's application type, dbo.application_types.) */
async function ensureLookupLinks() {
  if (lookupLinksEnsured) return;
  await LandUse.ensureSchema(); // the FK target must exist first

  if (!(await proponentColumnExists("land_use_id"))) await updateSchema(`ALTER TABLE dbo.proponents ADD land_use_id INT NULL;`);
  await updateSchema(`
    IF OBJECT_ID('dbo.FK_proponents_land_use', 'F') IS NULL
      ALTER TABLE dbo.proponents ADD CONSTRAINT FK_proponents_land_use FOREIGN KEY (land_use_id) REFERENCES dbo.land_use(id);
  `);
  lookupLinksEnsured = true;
}

/** Stockholders / contact people are edited through the locator form, so both tables must exist. */
async function ensureChildTables() {
  await Stockholder().ensureSchema();
  await ContactPerson().ensureSchema();
  await Signatory().ensureSchema();
  await FinancialTerms().ensureSchema();
  await Investment().ensureSchema();
}

/** Replaces every property-schedule row for a proponent with the given list
 * — the simplest correct sync for an inline editable table with its own
 * add/remove-row buttons (no per-row identity worth preserving server-side
 * between saves). No-op (leaves existing rows alone) when `properties` is
 * undefined, so a caller that doesn't touch this table doesn't wipe it. */
async function replaceProponentProperties(tx, proponentId, properties) {
  if (properties === undefined) return;
  await tx.query(`DELETE FROM dbo.proponent_properties WHERE proponent_id = @param0`, [proponentId]);
  if (!Array.isArray(properties) || !properties.length) return;

  for (let i = 0; i < properties.length; i++) {
    const row = properties[i] || {};
    await tx.query(
      `
      INSERT INTO dbo.proponent_properties
        (proponent_id, sort_order, year, date_from, date_to, type_of_property, area_sqm, rate_sqm_mo, rate_currency, mgl_mo, mgl_currency)
      VALUES
        (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, @param9, @param10)
      `,
      [
        proponentId,
        i,
        row.year || null,
        row.date_from || null,
        row.date_to || null,
        row.type_of_property || null,
        row.area_sqm || null,
        row.rate_sqm_mo || null,
        row.rate_currency || null,
        row.mgl_mo || null,
        row.mgl_currency || null,
      ]
    );
  }
}

async function getProponentProperties(proponentId) {
  const rows = await selectData(
    `
    SELECT id, year, date_from, date_to, type_of_property, area_sqm, rate_sqm_mo, rate_currency, mgl_mo, mgl_currency
    FROM dbo.proponent_properties
    WHERE proponent_id = @param0
    ORDER BY sort_order ASC, id ASC
    `,
    [proponentId]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    year: r.year ?? null,
    date_from: r.date_from ?? null,
    date_to: r.date_to ?? null,
    type_of_property: r.type_of_property ?? null,
    area_sqm: r.area_sqm ?? null,
    rate_sqm_mo: r.rate_sqm_mo ?? null,
    rate_currency: r.rate_currency ?? null,
    mgl_mo: r.mgl_mo ?? null,
    mgl_currency: r.mgl_currency ?? null,
  }));
}

/** `approvedOnly` scopes this down to locators with at least one APPROVED
 * application — used ONLY by the "Registered Locator" master checklist page.
 * This function is also the shared source for the New Application proponent
 * picker (ApplicationsWorkflow.tsx) and Locator Users' "has business
 * profile" filter, both of which need the FULL proponent universe (a
 * brand-new locator filing their first-ever application has no approved
 * application yet, by definition) — defaulting to unfiltered and only
 * narrowing on explicit opt-in avoids locking new locators out of filing. */
async function listProponents({ approvedOnly = false } = {}) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      p.id,
      p.user_id,
      p.business_name,
      p.registration_no,
      p.tin,
      p.address,
      p.contact_no,
      p.ref_no,
      p.created_by,
      p.updated_by,
      p.created_at,
      p.updated_at,
      p.is_active,
      u.email AS email,
      u.full_name AS contact_name,
      u.status AS account_status
    FROM dbo.proponents p
    LEFT JOIN dbo.users u ON u.id = p.user_id
    ${approvedOnly ? "WHERE EXISTS (SELECT 1 FROM dbo.applications a WHERE a.proponent_id = p.id AND a.status = 'APPROVED')" : ""}
    ORDER BY p.id DESC
    `
  );

  return rows.map((p) => ({
    id: p.id,
    user_id: p.user_id ?? null,
    business_name: p.business_name,
    registration_no: p.registration_no ?? null,
    tin: p.tin ? decryptValue(p.tin) : null,
    address: p.address ?? null,
    contact_no: p.contact_no ?? null,
    ref_no: p.ref_no ?? null,
    created_by: p.created_by ?? null,
    updated_by: p.updated_by ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    is_active: p.is_active,
    // Locator's own login email/name (not the business itself) — used by
    // the New Application picker to show who'll receive the activation
    // email, and account_status ("PENDING" = created but not yet activated,
    // see c_users.js's deferred-locator-activation flow) so staff can tell
    // at a glance whether picking this locator will trigger that email.
    email: p.email ?? null,
    contact_name: p.contact_name ?? null,
    account_status: p.account_status ?? null,
  }));
}

async function getProponentById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      p.id,
      p.user_id,
      p.business_name,
      p.registration_no,
      p.tin,
      p.address,
      p.contact_no,
      p.ref_no,
      p.location,
      p.ref_code,
      p.lease_address,
      p.account_officer_id,
      officer.full_name AS account_officer_name,
      p.sec_registration_date,
      p.date_signed,
      p.grace_period,
      p.is_sublease,
      p.sub_pgro,
      p.sub_pgrr,
      p.land_use,
      p.land_use_id,
      lu.name AS land_use_name,
      p.extension_date,
      p.extension_remarks,
      p.authorized_capital,
      p.authorized_capital_currency,
      p.subscribed_capital,
      p.subscribed_capital_currency,
      p.paid_up_capital,
      p.paid_up_capital_currency,
      p.business_activities,
      p.created_by,
      p.updated_by,
      p.created_at,
      p.updated_at,
      p.is_active,
      ct.effective_start AS start_term,
      ct.effective_end AS end_term,
      ct.contract_type_id,
      toctype.name AS contract_type_name,
      apptype.name AS business_type
    FROM dbo.proponents p
    LEFT JOIN dbo.users officer ON officer.id = p.account_officer_id
    LEFT JOIN dbo.land_use lu ON lu.id = p.land_use_id
    OUTER APPLY (
      SELECT TOP (1) c.effective_start, c.effective_end, c.contract_type_id
      FROM dbo.contracts c
      INNER JOIN dbo.applications a ON a.id = c.application_id
      WHERE a.proponent_id = p.id
      ORDER BY c.effective_end DESC, c.id DESC
    ) ct
    LEFT JOIN dbo.type_of_contract toctype ON toctype.id = ct.contract_type_id
    OUTER APPLY (
      SELECT TOP (1) a2.application_type
      FROM dbo.applications a2
      WHERE a2.proponent_id = p.id
      ORDER BY a2.created_at DESC, a2.id DESC
    ) latest_app
    LEFT JOIN dbo.application_types apptype ON apptype.code = latest_app.application_type
    WHERE p.id = @param0
    `,
    [id]
  );

  const p = rows?.[0] || null;
  if (!p) return null;
  const properties = await getProponentProperties(id);
  const [stockholders, contact_persons, signatories, financialTerms, investment] = await Promise.all([
    Stockholder().listForProponent(id),
    ContactPerson().listForProponent(id),
    Signatory().listForProponent(id),
    FinancialTerms().getForProponent(id),
    Investment().getForProponent(id),
  ]);
  return {
    id: p.id,
    user_id: p.user_id ?? null,
    business_name: p.business_name,
    registration_no: p.registration_no ?? null,
    tin: p.tin ? decryptValue(p.tin) : null,
    address: p.address ?? null,
    contact_no: p.contact_no ?? null,
    ref_no: p.ref_no ?? null,
    location: p.location ?? null,
    ref_code: p.ref_code ?? null,
    lease_address: p.lease_address ?? null,
    account_officer_id: p.account_officer_id ?? null,
    account_officer_name: p.account_officer_name ?? null,
    sec_registration_date: p.sec_registration_date ?? null,
    date_signed: p.date_signed ?? null,
    grace_period: p.grace_period ?? null,
    is_sublease: p.is_sublease ?? null,
    sub_pgro: p.sub_pgro ?? null,
    sub_pgrr: p.sub_pgrr ?? null,
    land_use: p.land_use ?? null,
    land_use_id: p.land_use_id ?? null,
    land_use_name: p.land_use_name ?? null,
    extension_date: p.extension_date ?? null,
    extension_remarks: p.extension_remarks ?? null,
    authorized_capital: p.authorized_capital ?? null,
    authorized_capital_currency: p.authorized_capital_currency ?? null,
    subscribed_capital: p.subscribed_capital ?? null,
    subscribed_capital_currency: p.subscribed_capital_currency ?? null,
    paid_up_capital: p.paid_up_capital ?? null,
    paid_up_capital_currency: p.paid_up_capital_currency ?? null,
    business_activities: p.business_activities ?? null,
    ...financialTerms,
    ...investment,
    start_term: p.start_term ?? null,
    end_term: p.end_term ?? null,
    lease_term: formatLeaseTerm(p.start_term, p.end_term),
    contract_type_id: p.contract_type_id ?? null,
    contract_type_name: p.contract_type_name ?? null,
    business_type: p.business_type ?? null,
    properties,
    stockholders,
    contact_persons,
    signatories,
    created_by: p.created_by ?? null,
    updated_by: p.updated_by ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    is_active: p.is_active,
  };
}

/**
 * Locators/Proponent List view. Extends the base proponent record with
 * fields that must stay dynamically in sync with the rest of the workflow
 * rather than being duplicated/typed in a second time:
 *  - encoded_by: the staff user who created the record (p.created_by).
 *  - business_type: the Application Type of the proponent's most recently
 *    filed application (dbo.applications.application_type resolved against
 *    dbo.application_types) — reflects whatever was actually filed.
 *  - start_term/end_term/lease_term: the effective dates of the proponent's
 *    most recent contract (dbo.contracts, via its application), with
 *    lease_term computed at read time so it can't drift from those dates.
 * A proponent with no application/contract yet simply shows blanks for the
 * fields that depend on one.
 */
async function listProponentsForLocatorList() {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      p.id,
      p.ref_no,
      p.business_name,
      p.registration_no,
      p.address,
      p.contact_no,
      p.is_active,
      p.created_at,
      creator.full_name AS encoded_by,
      apptype.name AS business_type,
      ct.effective_start AS start_term,
      ct.effective_end AS end_term
    FROM dbo.proponents p
    LEFT JOIN dbo.users creator ON creator.id = p.created_by
    OUTER APPLY (
      SELECT TOP (1) a.application_type
      FROM dbo.applications a
      WHERE a.proponent_id = p.id
      ORDER BY a.created_at DESC, a.id DESC
    ) latest_app
    LEFT JOIN dbo.application_types apptype ON apptype.code = latest_app.application_type
    OUTER APPLY (
      SELECT TOP (1) c.effective_start, c.effective_end
      FROM dbo.contracts c
      INNER JOIN dbo.applications a2 ON a2.id = c.application_id
      WHERE a2.proponent_id = p.id
      ORDER BY c.effective_end DESC, c.id DESC
    ) ct
    ORDER BY p.id DESC
    `
  );

  return rows.map((p) => ({
    id: p.id,
    ref_no: p.ref_no ?? null,
    tenant: p.business_name,
    registration_no: p.registration_no ?? null,
    address: p.address ?? null,
    contact_no: p.contact_no ?? null,
    is_active: p.is_active,
    created_at: p.created_at ?? null,
    encoded_by: p.encoded_by ?? null,
    business_type: p.business_type ?? null,
    start_term: p.start_term ?? null,
    end_term: p.end_term ?? null,
    lease_term: formatLeaseTerm(p.start_term, p.end_term),
  }));
}

async function createProponent({
  user_id,
  business_name,
  registration_no,
  tin,
  address,
  contact_no,
  location,
  ref_code,
  lease_address,
  account_officer_id,
  sec_registration_date,
  date_signed,
  grace_period,
  is_sublease,
  sub_pgro,
  sub_pgrr,
  land_use,
  extension_date,
  extension_remarks,
  authorized_capital,
  authorized_capital_currency,
  subscribed_capital,
  subscribed_capital_currency,
  paid_up_capital,
  paid_up_capital_currency,
  business_activities,
  advance_lease_payment_months,
  advance_lease_payment_amount,
  advance_lease_payment_currency,
  security_deposit_months,
  security_deposit_amount,
  security_deposit_currency,
  performance_security_months,
  performance_security_amount,
  performance_security_currency,
  investment_commitment,
  investment_actual,
  employee_commitment,
  employee_actual,
  properties,
  land_use_id,
  stockholders,
  contact_persons,
  signatories,
  created_by,
  is_active = 1,
}) {
  await ensureSchema();
  await ensureChildTables();
  const active = is_active ? 1 : 0;
  const userId = toInt(user_id);
  const createdBy = toInt(created_by);
  const accountOfficerId = toInt(account_officer_id);
  const isSublease = is_sublease === null || is_sublease === undefined ? null : is_sublease ? 1 : 0;

  const newId = await runInTransaction(async (tx) => {
    // Minted here, never accepted from the caller — same reasoning as
    // application_no/contract_no (see generateApplicationNo).
    const refNo = await generateLocatorRefNo(tx);

    const result = await tx.query(
      `
      INSERT INTO dbo.proponents
        (user_id,business_name,registration_no,tin,address,contact_no,location,
         ref_code,lease_address,account_officer_id,sec_registration_date,date_signed,
         grace_period,is_sublease,sub_pgro,sub_pgrr,land_use,extension_date,extension_remarks,
         authorized_capital,authorized_capital_currency,subscribed_capital,subscribed_capital_currency,
         paid_up_capital,paid_up_capital_currency,
         business_activities,
         land_use_id,
         ref_no,created_by,updated_by,created_at,updated_at,is_active)
      OUTPUT INSERTED.id
      VALUES
        (@param0,@param1,@param2,@param3,@param4,@param5,@param6,
         @param7,@param8,@param9,@param10,@param11,
         @param12,@param13,@param14,@param15,@param16,@param17,@param18,
         @param19,@param20,@param21,@param22,
         @param23,@param24,
         @param25,
         @param26,
         @param27,@param28,NULL,GETDATE(),NULL,@param29)
      `,
      [
        userId, business_name, registration_no, encryptValue(tin), address, contact_no, location ?? null,
        ref_code ?? null, lease_address ?? null, accountOfficerId, sec_registration_date ?? null, date_signed ?? null,
        grace_period ?? null, isSublease, sub_pgro ?? null, sub_pgrr ?? null, land_use ?? null, extension_date ?? null, extension_remarks ?? null,
        authorized_capital ?? null, authorized_capital_currency ?? null, subscribed_capital ?? null, subscribed_capital_currency ?? null,
        paid_up_capital ?? null, paid_up_capital_currency ?? null,
        business_activities ?? null,
        toInt(land_use_id),
        refNo, createdBy, active,
      ]
    );
    const insertedId = result?.recordset?.[0]?.id;
    await replaceProponentProperties(tx, insertedId, properties);
    await Stockholder().syncForProponent(tx, insertedId, stockholders, createdBy);
    await ContactPerson().syncForProponent(tx, insertedId, contact_persons, createdBy);
    await Signatory().syncForProponent(tx, insertedId, signatories, createdBy);
    await FinancialTerms().upsertForProponent(
      tx,
      insertedId,
      {
        advance_lease_payment_months,
        advance_lease_payment_amount,
        advance_lease_payment_currency,
        security_deposit_months,
        security_deposit_amount,
        security_deposit_currency,
        performance_security_months,
        performance_security_amount,
        performance_security_currency,
      },
      createdBy
    );
    await Investment().upsertForProponent(
      tx,
      insertedId,
      {
        investment_commitment,
        investment_actual,
        employee_commitment,
        employee_actual,
      },
      createdBy
    );
    return insertedId;
  });

  return await getProponentById(newId);
}

async function updateProponent(
  id,
  {
    user_id,
    business_name,
    registration_no,
    tin,
    address,
    contact_no,
    location,
    ref_code,
    lease_address,
    account_officer_id,
    sec_registration_date,
    date_signed,
    grace_period,
    is_sublease,
    sub_pgro,
    sub_pgrr,
    land_use,
    extension_date,
    extension_remarks,
    authorized_capital,
    authorized_capital_currency,
    subscribed_capital,
    subscribed_capital_currency,
    paid_up_capital,
    paid_up_capital_currency,
    business_activities,
    advance_lease_payment_months,
    advance_lease_payment_amount,
    advance_lease_payment_currency,
    security_deposit_months,
    security_deposit_amount,
    security_deposit_currency,
    performance_security_months,
    performance_security_amount,
    performance_security_currency,
    investment_commitment,
    investment_actual,
    employee_commitment,
    employee_actual,
    properties,
    land_use_id,
    stockholders,
    contact_persons,
    signatories,
    updated_by,
    is_active,
  }
) {
  await ensureSchema();
  await ensureChildTables();
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };

  if (user_id !== undefined) pushSet("user_id = ?", toInt(user_id));
  if (business_name !== undefined) pushSet("business_name = ?", business_name);
  if (registration_no !== undefined) pushSet("registration_no = ?", registration_no);
  if (tin !== undefined) pushSet("tin = ?", encryptValue(tin));
  if (address !== undefined) pushSet("address = ?", address);
  if (contact_no !== undefined) pushSet("contact_no = ?", contact_no);
  if (location !== undefined) pushSet("location = ?", location);
  if (ref_code !== undefined) pushSet("ref_code = ?", ref_code);
  if (lease_address !== undefined) pushSet("lease_address = ?", lease_address);
  if (account_officer_id !== undefined) pushSet("account_officer_id = ?", toInt(account_officer_id));
  if (sec_registration_date !== undefined) pushSet("sec_registration_date = ?", sec_registration_date);
  if (date_signed !== undefined) pushSet("date_signed = ?", date_signed);
  if (grace_period !== undefined) pushSet("grace_period = ?", grace_period);
  if (is_sublease !== undefined) pushSet("is_sublease = ?", is_sublease === null ? null : is_sublease ? 1 : 0);
  if (sub_pgro !== undefined) pushSet("sub_pgro = ?", sub_pgro);
  if (sub_pgrr !== undefined) pushSet("sub_pgrr = ?", sub_pgrr);
  if (land_use !== undefined) pushSet("land_use = ?", land_use);
  if (extension_date !== undefined) pushSet("extension_date = ?", extension_date);
  if (extension_remarks !== undefined) pushSet("extension_remarks = ?", extension_remarks);
  if (authorized_capital !== undefined) pushSet("authorized_capital = ?", authorized_capital);
  if (authorized_capital_currency !== undefined) pushSet("authorized_capital_currency = ?", authorized_capital_currency);
  if (subscribed_capital !== undefined) pushSet("subscribed_capital = ?", subscribed_capital);
  if (subscribed_capital_currency !== undefined) pushSet("subscribed_capital_currency = ?", subscribed_capital_currency);
  if (paid_up_capital !== undefined) pushSet("paid_up_capital = ?", paid_up_capital);
  if (paid_up_capital_currency !== undefined) pushSet("paid_up_capital_currency = ?", paid_up_capital_currency);
  if (business_activities !== undefined) pushSet("business_activities = ?", business_activities);
  if (land_use_id !== undefined) pushSet("land_use_id = ?", toInt(land_use_id));
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);

  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);

  await runInTransaction(async (tx) => {
    if (sets.length) {
      const query = `
        UPDATE dbo.proponents
        SET ${sets.join(", ")}, updated_at = GETDATE()
        WHERE id = @param${params.length}
      `;
      await tx.query(query, [...params, id]);
    }
    await replaceProponentProperties(tx, id, properties);
    await Stockholder().syncForProponent(tx, id, stockholders, updatedBy);
    await ContactPerson().syncForProponent(tx, id, contact_persons, updatedBy);
    await Signatory().syncForProponent(tx, id, signatories, updatedBy);
    await FinancialTerms().upsertForProponent(
      tx,
      id,
      {
        advance_lease_payment_months,
        advance_lease_payment_amount,
        advance_lease_payment_currency,
        security_deposit_months,
        security_deposit_amount,
        security_deposit_currency,
        performance_security_months,
        performance_security_amount,
        performance_security_currency,
      },
      updatedBy
    );
    await Investment().upsertForProponent(
      tx,
      id,
      {
        investment_commitment,
        investment_actual,
        employee_commitment,
        employee_actual,
      },
      updatedBy
    );
  });

  return await getProponentById(id);
}

async function deactivateProponent(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.proponents
    SET is_active = 0,
        updated_at = GETDATE(),
        updated_by = @param1
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return await getProponentById(id);
}

async function reactivateProponent(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.proponents
    SET is_active = 1,
        updated_at = GETDATE(),
        updated_by = @param1
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return await getProponentById(id);
}

/**
 * Flips is_active for the proponent row linked to a user. Used when an admin
 * approves/rejects a self-service registration (the proponent row is created
 * inactive alongside the PENDING user).
 */
async function setActiveByUserId(userId, active, updated_by) {
  await ensureSchema();
  const uid = toInt(userId);
  if (!uid) return null;
  await updateData(
    `
    UPDATE dbo.proponents
    SET is_active = @param1,
        updated_at = GETDATE(),
        updated_by = @param2
    WHERE user_id = @param0
    `,
    [uid, active ? 1 : 0, toInt(updated_by)]
  );
  return true;
}

async function getProponentByUserId(userId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      p.id,
      p.user_id,
      p.business_name,
      p.registration_no,
      p.tin,
      p.address,
      p.lease_address,
      p.contact_no,
      p.created_by,
      p.updated_by,
      p.created_at,
      p.updated_at,
      p.is_active
    FROM dbo.proponents p
    WHERE p.user_id = @param0 AND p.is_active = 1
    `,
    [userId]
  );

  const p = rows?.[0] || null;
  if (!p) return null;
  return {
    id: p.id,
    user_id: p.user_id ?? null,
    business_name: p.business_name,
    registration_no: p.registration_no ?? null,
    tin: p.tin ? decryptValue(p.tin) : null,
    address: p.address ?? null,
    lease_address: p.lease_address ?? null,
    contact_no: p.contact_no ?? null,
    created_by: p.created_by ?? null,
    updated_by: p.updated_by ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    is_active: p.is_active,
  };
}

async function proponentExists(id) {
  const rows = await selectData(`SELECT TOP (1) id FROM dbo.proponents WHERE id = @param0`, [id]);
  return Boolean(rows?.[0]);
}

/* ------------------------------------------------------------------------------------
 * Section saves. The locator form's Stockholders / Contact Person (+ Signatory) / Property
 * schedule sections each have their own Save, because this data is filled in over time,
 * not in one sitting. Each one writes only its own table(s) (all keyed by proponent_id)
 * and returns the saved rows — with their ids — so the form can keep editing them in
 * place. They never touch the locator's own fields.
 * Each returns null when the locator doesn't exist.
 * ---------------------------------------------------------------------------------- */

async function saveStockholders(id, stockholders, actorId) {
  await ensureSchema();
  await ensureChildTables();
  if (!(await proponentExists(id))) return null;
  await runInTransaction((tx) => Stockholder().syncForProponent(tx, id, stockholders, actorId));
  return { stockholders: await Stockholder().listForProponent(id) };
}

async function saveContacts(id, { contact_persons, signatories }, actorId) {
  await ensureSchema();
  await ensureChildTables();
  if (!(await proponentExists(id))) return null;
  await runInTransaction(async (tx) => {
    await ContactPerson().syncForProponent(tx, id, contact_persons, actorId);
    await Signatory().syncForProponent(tx, id, signatories, actorId);
  });
  const [contacts, signers] = await Promise.all([ContactPerson().listForProponent(id), Signatory().listForProponent(id)]);
  return { contact_persons: contacts, signatories: signers };
}

async function saveProperties(id, properties) {
  await ensureSchema();
  if (!(await proponentExists(id))) return null;
  await runInTransaction((tx) => replaceProponentProperties(tx, id, properties));
  return { properties: await getProponentProperties(id) };
}

async function saveInvestment(id, fields, actorId) {
  await ensureSchema();
  await ensureChildTables();
  if (!(await proponentExists(id))) return null;
  await runInTransaction((tx) => Investment().upsertForProponent(tx, id, fields, actorId));
  return Investment().getForProponent(id);
}

module.exports = {
  ensureSchema,
  saveStockholders,
  saveContacts,
  saveProperties,
  saveInvestment,
  listProponents,
  listProponentsForLocatorList,
  getProponentById,
  getProponentByUserId,
  createProponent,
  updateProponent,
  deactivateProponent,
  reactivateProponent,
  setActiveByUserId,
};

