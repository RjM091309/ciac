/**
 * One-time, idempotent: points each locator's current contract at a row of
 * dbo.type_of_contract (File Maintenance > Type of Contract) via contracts.contract_type_id.
 *
 * Locators whose current contract has NO type yet are filled from the legacy
 * dbLocator.TypeContract text, matched by name to type_of_contract.name. Blank or
 * unrecognised legacy values are only reported — never guessed. (Contracts that still
 * carry an old "TOC_..." code are converted automatically on boot, see Contract.js.)
 *
 * Dry-run by default (prints what it WOULD do). Pass --apply to write.
 * Legacy database defaults to "actual" (bridge_import on the VPS):
 *   LEGACY_DB=bridge_import node server/scripts/backfill-contract-types.js --apply
 */
const { selectData } = require("../config/database");
const TypeOfContract = require("../models/TypeOfContract");
const Contract = require("../models/Contract");

const APPLY = process.argv.includes("--apply");
const LEGACY_DB = process.env.LEGACY_DB || "actual";
if (!/^\w+$/.test(LEGACY_DB)) throw new Error("LEGACY_DB must be a plain database name");

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

async function run() {
  await Contract.ensureSchema(); // also creates type_of_contract and contracts.contract_type_id

  const types = await TypeOfContract.listTypeOfContracts();
  const idByName = new Map(types.map((t) => [norm(t.name), t.id]));
  console.log(`type_of_contract: ${types.length} types`);

  const legacy = await selectData(
    `SELECT RefNo, TypeContract FROM ${LEGACY_DB}.dbo.dbLocator WHERE Deleted = 0 OR Deleted IS NULL`
  );
  const legacyByRef = new Map(legacy.map((r) => [String(r.RefNo || "").trim(), norm(r.TypeContract)]));

  const current = await selectData(`
    SELECT p.id, p.ref_no, ct.id AS contract_id, ct.contract_type_id
    FROM dbo.proponents p
    OUTER APPLY (
      SELECT TOP (1) c.id, c.contract_type_id
      FROM dbo.contracts c
      INNER JOIN dbo.applications a ON a.id = c.application_id
      WHERE a.proponent_id = p.id
      ORDER BY c.effective_end DESC, c.id DESC
    ) ct
  `);

  const stats = { filled: 0, alreadyTyped: 0, noContract: 0, noLegacyRow: 0, blank: 0 };
  const unmatched = new Map();
  for (const p of current) {
    if (!p.contract_id) { stats.noContract++; continue; }
    if (p.contract_type_id) { stats.alreadyTyped++; continue; }
    const text = legacyByRef.get(String(p.ref_no || "").trim());
    if (text === undefined) { stats.noLegacyRow++; continue; }
    if (!text) { stats.blank++; continue; }
    const id = idByName.get(text);
    if (!id) { unmatched.set(text, (unmatched.get(text) || 0) + 1); continue; }
    stats.filled++;
    if (APPLY) await Contract.setContractTypeForProponent(p.id, id, null);
  }

  console.log(`\nuntyped current contracts filled from legacy TypeContract: ${stats.filled}`);
  console.log(`already typed: ${stats.alreadyTyped} | no contract yet: ${stats.noContract} | not in legacy: ${stats.noLegacyRow} | legacy value blank: ${stats.blank}`);
  for (const [text, n] of unmatched) console.log(`? "${text}" x${n}: no type_of_contract with this name — left blank`);

  console.log(APPLY ? "\nApplied." : "\nDry run only — re-run with --apply to write.");
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
