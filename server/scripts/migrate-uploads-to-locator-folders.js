// Moves uploaded files from the old layout into one folder per locator
// (see lib/locatorFolders.js) and updates their paths in the database:
//
//   <id>/x.pdf                    → locators/<Ref No>/<APP-…|REN-…>/x.pdf   (documents)
//   documents/x.pdf               → locators/<Ref No>/documents/x.pdf        (proponent_documents)
//   contracts/<id>/certificate.pdf → locators/<Ref No>/contracts/<contract no>/certificate.pdf
//   permits/<id>/certificate.pdf   → locators/<Ref No>/permits/<permit no>/certificate.pdf
//
// Usage (from the server folder):
//   node scripts/migrate-uploads-to-locator-folders.js            dry run: lists what would move
//   node scripts/migrate-uploads-to-locator-folders.js --apply    moves the files
//   node scripts/migrate-uploads-to-locator-folders.js --rollback <log file>
//
// --apply writes a log (old → new for every file) to
// <STORAGE_ROOT>/locators/_migration-<timestamp>.json; --rollback with that
// file moves everything back. Files already under locators/ are left alone,
// so it's safe to run again.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");
const path = require("path");
const { selectData, updateData } = require("../config/database");
const { STORAGE_ROOT, resolveStoredPath, relativeStoragePath } = require("../lib/fileStorage");
const { LOCATORS_DIR, folderName, locatorDir, applicationDir } = require("../lib/locatorFolders");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback") ? args[args.indexOf("--rollback") + 1] : null;

const TABLES = {
  documents: "storage_path",
  proponent_documents: "storage_path",
  contracts: "certificate_path",
  permits: "certificate_path",
};

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

/** Removes now-empty folders left behind (never STORAGE_ROOT itself). */
function pruneEmpty(dir) {
  let current = dir;
  while (current && current.startsWith(STORAGE_ROOT + path.sep)) {
    try {
      if (fs.readdirSync(current).length) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

async function plan() {
  const items = [];
  const isNew = (p) => String(p || "").startsWith(`${LOCATORS_DIR}/`);

  for (const d of await selectData(`SELECT id, application_id, storage_path FROM dbo.documents WHERE storage_path IS NOT NULL`)) {
    if (isNew(d.storage_path) || !d.application_id) continue;
    const dir = APPLY ? await applicationDir(d.application_id) : await dirPreview("app", d.application_id);
    if (dir) items.push({ table: "documents", id: d.id, from: d.storage_path, toDir: dir });
  }
  for (const d of await selectData(`SELECT id, proponent_id, storage_path FROM dbo.proponent_documents WHERE storage_path IS NOT NULL`)) {
    if (isNew(d.storage_path) || !d.proponent_id) continue;
    const dir = APPLY ? await locatorDir(d.proponent_id, "documents") : await dirPreview("loc", d.proponent_id, "documents");
    if (dir) items.push({ table: "proponent_documents", id: d.id, from: d.storage_path, toDir: dir });
  }
  for (const c of await selectData(
    `SELECT c.id, c.contract_no, c.certificate_path, a.proponent_id
     FROM dbo.contracts c LEFT JOIN dbo.applications a ON a.id = c.application_id
     WHERE c.certificate_path IS NOT NULL`
  )) {
    if (isNew(c.certificate_path) || !c.proponent_id) continue;
    const sub = ["contracts", folderName(c.contract_no, String(c.id))];
    const dir = APPLY ? await locatorDir(c.proponent_id, ...sub) : await dirPreview("loc", c.proponent_id, ...sub);
    if (dir) items.push({ table: "contracts", id: c.id, from: c.certificate_path, toDir: dir });
  }
  for (const p of await selectData(`SELECT id, permit_no, proponent_id, certificate_path FROM dbo.permits WHERE certificate_path IS NOT NULL`)) {
    if (isNew(p.certificate_path) || !p.proponent_id) continue;
    const sub = ["permits", folderName(p.permit_no, String(p.id))];
    const dir = APPLY ? await locatorDir(p.proponent_id, ...sub) : await dirPreview("loc", p.proponent_id, ...sub);
    if (dir) items.push({ table: "permits", id: p.id, from: p.certificate_path, toDir: dir });
  }
  return items;
}

/** Dry run: the folder a file would go to, without creating it. */
async function dirPreview(kind, id, ...sub) {
  if (kind === "app") {
    const rows = await selectData(
      `SELECT TOP (1) a.application_no, a.id, p.id AS pid, p.ref_no
       FROM dbo.applications a LEFT JOIN dbo.proponents p ON p.id = a.proponent_id WHERE a.id = @param0`,
      [id]
    );
    const r = rows?.[0];
    if (!r?.pid) return null;
    return path.join(STORAGE_ROOT, LOCATORS_DIR, folderName(r.ref_no, `P${r.pid}`), folderName(r.application_no, `A${r.id}`));
  }
  const rows = await selectData(`SELECT TOP (1) id, ref_no FROM dbo.proponents WHERE id = @param0`, [id]);
  const r = rows?.[0];
  if (!r) return null;
  return path.join(STORAGE_ROOT, LOCATORS_DIR, folderName(r.ref_no, `P${r.id}`), ...sub);
}

async function migrate() {
  const items = await plan();
  console.log(`Storage root: ${STORAGE_ROOT}`);
  console.log(`${items.length} file(s) to move${APPLY ? "" : " (dry run — add --apply to move them)"}\n`);
  const log = [];
  let moved = 0;
  let skipped = 0;
  for (const it of items) {
    const fromAbs = resolveStoredPath(it.from);
    const toAbs = path.join(it.toDir, path.basename(it.from));
    const to = relativeStoragePath(toAbs);
    if (!fromAbs || !fs.existsSync(fromAbs)) {
      console.log(`  SKIP  ${it.table}#${it.id}: file missing (${it.from})`);
      skipped++;
      continue;
    }
    if (fs.existsSync(toAbs)) {
      console.log(`  SKIP  ${it.table}#${it.id}: ${to} already exists`);
      skipped++;
      continue;
    }
    console.log(`  ${APPLY ? "MOVE" : "would move"}  ${it.from}  →  ${to}`);
    if (!APPLY) continue;
    move(fromAbs, toAbs);
    try {
      await updateData(`UPDATE dbo.${it.table} SET ${TABLES[it.table]} = @param1 WHERE id = @param0`, [it.id, to]);
    } catch (error) {
      move(toAbs, fromAbs); // keep file and row in step
      throw error;
    }
    log.push({ table: it.table, id: it.id, from: it.from, to });
    pruneEmpty(path.dirname(fromAbs));
    moved++;
  }
  if (APPLY && log.length) {
    const file = path.join(STORAGE_ROOT, LOCATORS_DIR, `_migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    console.log(`\nLog (for --rollback): ${file}`);
  }
  console.log(`\nDone: ${APPLY ? moved : items.length - skipped} ${APPLY ? "moved" : "to move"}, ${skipped} skipped.`);
}

async function rollback(file) {
  const log = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0;
  for (const it of log.reverse()) {
    const fromAbs = resolveStoredPath(it.to);
    const toAbs = resolveStoredPath(it.from);
    if (!fromAbs || !toAbs || !fs.existsSync(fromAbs)) {
      console.log(`  SKIP  ${it.table}#${it.id}: ${it.to} not found`);
      continue;
    }
    move(fromAbs, toAbs);
    await updateData(`UPDATE dbo.${it.table} SET ${TABLES[it.table]} = @param1 WHERE id = @param0`, [it.id, it.from]);
    pruneEmpty(path.dirname(fromAbs));
    n++;
  }
  console.log(`Rolled back ${n} file(s).`);
}

(ROLLBACK ? rollback(ROLLBACK) : migrate())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
