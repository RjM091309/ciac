/**
 * One-time backfill: populates the "Profile" fields added to dbo.proponents
 * (ref_code, lease_address, account_officer_id, sec_registration_date,
 * date_signed, grace_period, is_sublease, sub_pgro, sub_pgrr, land_use,
 * extension_remarks, authorized/subscribed/paid_up capital + currency) for
 * every locator migrated from the legacy BRIDGE system
 * (bridge_import.dbo.dbLocator, matched via proponents.ref_no = dbLocator.RefNo).
 *
 * Account Officer follows the same "real FK, placeholder account for names
 * with no existing login" pattern already used for Encoded By in
 * migrate-legacy-locators.js — never a flat text column.
 *
 * Idempotent: only touches proponents whose ref_code is still NULL.
 * Usage: node server/scripts/backfill-legacy-profile-fields.js
 */
const bcrypt = require("bcryptjs");
const { selectData, updateData } = require("../config/database");
const Proponent = require("../models/Proponent");

async function getOrCreateOfficerUser(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;

  const username = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!username) return null;

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
  return result?.[0]?.id ?? null;
}

function toBit(value) {
  if (value === true || value === 1) return 1;
  return 0;
}

async function run() {
  await Proponent.ensureSchema();

  const legacyRows = await selectData(`
    SELECT
      p.id AS proponent_id,
      loc.RefCode, loc.ActualAddress, loc.AccountOfficer, loc.SecReg, loc.SignedDT,
      loc.GracePeriod, loc.SubLeased, loc.SubPGRO, loc.SubPGRR, loc.LandUse, loc.Extension,
      loc.CapitalStock, loc.ACSCurrency, loc.SubscribedCapital, loc.SCCurrency,
      loc.PaidUpCapital, loc.PCCurrency
    FROM dbo.proponents p
    INNER JOIN bridge_import.dbo.dbLocator loc ON p.ref_no = loc.RefNo COLLATE DATABASE_DEFAULT
    WHERE p.ref_code IS NULL
  `);

  console.log(`Found ${legacyRows.length} migrated locators needing profile backfill.`);

  const officerIdByName = new Map();
  let updated = 0;

  for (const row of legacyRows) {
    let officerId = null;
    const officerName = String(row.AccountOfficer || "").trim();
    if (officerName) {
      if (!officerIdByName.has(officerName)) {
        officerIdByName.set(officerName, await getOrCreateOfficerUser(officerName));
      }
      officerId = officerIdByName.get(officerName);
    }

    await updateData(
      `
      UPDATE dbo.proponents
      SET ref_code = @param1,
          lease_address = @param2,
          account_officer_id = @param3,
          sec_registration_date = @param4,
          date_signed = @param5,
          grace_period = @param6,
          is_sublease = @param7,
          sub_pgro = @param8,
          sub_pgrr = @param9,
          land_use = @param10,
          extension_remarks = @param11,
          authorized_capital = @param12,
          authorized_capital_currency = @param13,
          subscribed_capital = @param14,
          subscribed_capital_currency = @param15,
          paid_up_capital = @param16,
          paid_up_capital_currency = @param17
      WHERE id = @param0
      `,
      [
        row.proponent_id,
        String(row.RefCode || "").trim() || null,
        String(row.ActualAddress || "").trim() || null,
        officerId,
        row.SecReg || null,
        row.SignedDT || null,
        String(row.GracePeriod || "").trim() || null,
        toBit(row.SubLeased),
        String(row.SubPGRO || "").trim() || null,
        String(row.SubPGRR || "").trim() || null,
        String(row.LandUse || "").trim() || null,
        String(row.Extension || "").trim() || null,
        String(row.CapitalStock || "").trim() || null,
        String(row.ACSCurrency || "").trim() || null,
        String(row.SubscribedCapital || "").trim() || null,
        String(row.SCCurrency || "").trim() || null,
        String(row.PaidUpCapital || "").trim() || null,
        String(row.PCCurrency || "").trim() || null,
      ]
    );
    updated++;
  }

  console.log(`Backfilled profile fields for ${updated} locators (${officerIdByName.size} distinct account officers resolved).`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Profile backfill failed:", error);
    process.exit(1);
  });
