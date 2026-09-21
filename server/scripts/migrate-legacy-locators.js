/**
 * One-time migration: imports active locators from the legacy BRIDGE system
 * (bridge_import.dbo.dbLocator, same SQL Server instance, cross-database
 * query) into this app's real relational schema — not a flat snapshot.
 *
 * For each legacy locator this creates:
 *   1. dbo.proponents      — the business record itself
 *   2. dbo.applications    — one historical record standing in for "how they
 *                            got their current lease", so Business Type
 *                            resolves through the same application_types
 *                            join every other locator uses
 *   3. dbo.contracts       — the actual lease dates, so Start/End/Lease Term
 *                            resolve through the same OUTER APPLY every
 *                            other locator uses
 * This way listProponentsForLocatorList() (server/models/Proponent.js) needs
 * no special-casing for imported rows — they flow through the exact same
 * dynamic joins as locators created going forward through the app.
 *
 * Idempotent: skips any legacy RefNo that already exists in dbo.proponents,
 * so it's safe to re-run (e.g. if bridge_import gets new rows later).
 *
 * Usage: node server/scripts/migrate-legacy-locators.js
 */
const bcrypt = require("bcryptjs");
const { selectData, runInTransaction, getConnection } = require("../config/database");
const Proponent = require("../models/Proponent");
const ApplicationWorkflow = require("../models/ApplicationWorkflow");
const Contract = require("../models/Contract");
const User = require("../models/User");
const { encryptValue } = require("../lib/crypto");

const ADMIN_USER_ID = 1; // "System Administrator" — fallback attribution when EncodedBy is blank.

/** Legacy TypeContract free text -> this app's application_types.code.
 * Only a handful of codes exist (see server/models/ApplicationType.js); this
 * maps the legacy contract-document wording onto the closest one. */
function mapApplicationTypeCode(typeContract) {
  const t = String(typeContract || "").toUpperCase();
  if (t.includes("SUBLEASE")) return "SUB_001";
  return "DIR_001"; // LEASE AGREEMENT, SHORT-TERM LEASE AGREEMENT, blank, etc.
}

async function getOrCreatePlaceholderUser(encodedBy) {
  const raw = String(encodedBy || "").trim();
  if (!raw) return ADMIN_USER_ID;

  const username = raw.toLowerCase();
  const existing = await selectData(`SELECT id FROM dbo.users WHERE username = @param0`, [username]);
  if (existing?.[0]?.id) return existing[0].id;

  const passwordHash = await bcrypt.hash(require("crypto").randomUUID(), 10);
  const email = `legacy.${username}@ciac.local`;
  const result = await selectData(
    `
    INSERT INTO dbo.users (username, email, password_hash, full_name, is_active, status)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, 0, 'DEACTIVATED')
    `,
    [username, email, passwordHash, `${raw} (Legacy Import)`]
  );
  return result?.[0]?.id ?? ADMIN_USER_ID;
}

/** The live proponents.user_id column turned out to be NOT NULL (older than
 * the nullable declaration in models/Proponent.js's CREATE TABLE, which only
 * applies when the table doesn't exist yet). These migrated businesses have
 * no real portal login of their own, so — rather than fabricating 155
 * individual fake locator accounts — everything points at one shared,
 * clearly-labeled, deactivated placeholder account. */
async function getOrCreateLegacyPlaceholderLocatorUser() {
  const username = "legacy_locator_placeholder";
  const existing = await selectData(`SELECT id FROM dbo.users WHERE username = @param0`, [username]);
  if (existing?.[0]?.id) return existing[0].id;

  const passwordHash = await bcrypt.hash(require("crypto").randomUUID(), 10);
  const result = await selectData(
    `
    INSERT INTO dbo.users (username, email, password_hash, full_name, is_active, status)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, 0, 'DEACTIVATED')
    `,
    [username, "legacy.placeholder@ciac.local", passwordHash, "Legacy Import Placeholder (no real portal account)"]
  );
  return result?.[0]?.id;
}

async function migrate() {
  await Proponent.ensureSchema();
  await ApplicationWorkflow.ensureSchema();
  await Contract.ensureSchema();
  await User.ensureSchema();

  const legacyRows = await selectData(`
    SELECT RefNo, Tenant, Address, ActualAddress, TINNo, TypeContract,
           StartTerm, EndTerm, SignedDT, EncodedBy, EncodedDT
    FROM bridge_import.dbo.dbLocator
    WHERE Deleted = 0 OR Deleted IS NULL
    ORDER BY RefNo ASC
  `);

  console.log(`Found ${legacyRows.length} active legacy locators.`);

  const placeholderLocatorUserId = await getOrCreateLegacyPlaceholderLocatorUser();

  let imported = 0;
  let skipped = 0;

  for (const row of legacyRows) {
    const refNo = String(row.RefNo || "").trim();
    if (!refNo) continue;

    const already = await selectData(`SELECT id FROM dbo.proponents WHERE ref_no = @param0`, [refNo]);
    if (already?.[0]?.id) {
      skipped++;
      continue;
    }

    const createdBy = await getOrCreatePlaceholderUser(row.EncodedBy);
    const businessName = String(row.Tenant || "").trim() || `Legacy Locator ${refNo}`;
    const address = String(row.Address || row.ActualAddress || "").trim() || null;
    const createdAt = row.EncodedDT || row.StartTerm || new Date();
    const applicationTypeCode = mapApplicationTypeCode(row.TypeContract);
    const issueDate = row.SignedDT || row.StartTerm || new Date();

    await runInTransaction(async (tx) => {
      const proponentResult = await tx.query(
        `
        INSERT INTO dbo.proponents
          (user_id, business_name, tin, address, ref_no, created_by, created_at, is_active)
        OUTPUT INSERTED.id
        VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, 1)
        `,
        [
          placeholderLocatorUserId,
          businessName,
          encryptValue(row.TINNo ? String(row.TINNo).trim() : null),
          address,
          refNo,
          createdBy,
          createdAt,
        ]
      );
      const proponentId = proponentResult?.recordset?.[0]?.id;

      const applicationResult = await tx.query(
        `
        INSERT INTO dbo.applications
          (proponent_id, application_no, application_type, is_renewal, status, submitted_at, created_by, created_at)
        OUTPUT INSERTED.id
        VALUES (@param0, @param1, @param2, 0, 'APPROVED', @param3, @param4, @param5)
        `,
        [proponentId, `LEGACY-${refNo}`, applicationTypeCode, row.StartTerm || createdAt, createdBy, createdAt]
      );
      const applicationId = applicationResult?.recordset?.[0]?.id;

      await tx.query(
        `
        INSERT INTO dbo.contracts
          (application_id, contract_no, issue_date, effective_start, effective_end, created_by, created_at)
        VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6)
        `,
        [applicationId, `LEGACY-${refNo}`, issueDate, row.StartTerm || null, row.EndTerm || null, createdBy, createdAt]
      );
    });

    imported++;
  }

  console.log(`Imported ${imported} locators, skipped ${skipped} already-imported.`);
}

migrate()
  .then(async () => {
    const pool = await getConnection();
    await pool.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error("Legacy locator migration failed:", error);
    process.exit(1);
  });
