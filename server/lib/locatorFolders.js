// Uploaded files are kept in one folder per locator, named by its Ref No:
//
//   <STORAGE_ROOT>/locators/LOC-2026-00001/
//     APP-2026-00001/            requirements the locator uploaded (and staff, for them)
//     REN-2026-00001/            a renewal's requirements
//     contracts/CTR-…/           contract certificate PDF
//     permits/<permit no>/       permit certificate PDF
//     documents/                 files staff uploaded on the Locator Documents tab
//
// Paths in the database stay relative to STORAGE_ROOT (resolveStoredPath),
// so moving STORAGE_DIR still works. Older files (uploads/<applicationId>/,
// uploads/contracts/<id>/ …) keep working where they are; the
// scripts/migrate-uploads-to-locator-folders.js script moves them.
const fs = require("fs");
const path = require("path");
const { selectData } = require("../config/database");
const { STORAGE_ROOT } = require("./fileStorage");

const LOCATORS_DIR = "locators";

/** A safe single folder name (Ref Nos / application numbers are already
 * plain, but nothing from the database goes into a path unchecked). */
function folderName(value, fallback) {
  const clean = String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

async function locatorFolder(proponentId) {
  const id = Number(proponentId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const rows = await selectData(`SELECT TOP (1) ref_no FROM dbo.proponents WHERE id = @param0`, [id]);
  return folderName(rows?.[0]?.ref_no, `P${id}`);
}

/** Absolute path of a folder under the locator's folder (created). */
async function locatorDir(proponentId, ...sub) {
  const base = await locatorFolder(proponentId);
  if (!base) return null;
  const dir = path.join(STORAGE_ROOT, LOCATORS_DIR, base, ...sub.map((s) => folderName(s, "misc")));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The application's folder: locators/<Ref No>/<APP-… or REN-…>/ */
async function applicationDir(applicationId) {
  const id = Number(applicationId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const rows = await selectData(
    `SELECT TOP (1) proponent_id, application_no FROM dbo.applications WHERE id = @param0`,
    [id]
  );
  const app = rows?.[0];
  if (!app?.proponent_id) return null;
  return locatorDir(app.proponent_id, folderName(app.application_no, `A${id}`));
}

/** Moves a file into `dir`, keeping its name. Returns the new absolute path,
 * or the old one if it couldn't be moved (the upload still works from there). */
function moveInto(absPath, dir) {
  if (!absPath || !dir) return absPath;
  const target = path.join(dir, path.basename(absPath));
  if (path.resolve(target) === path.resolve(absPath)) return absPath;
  try {
    fs.renameSync(absPath, target);
  } catch (error) {
    if (error.code !== "EXDEV") {
      console.error("Move upload into locator folder error:", error);
      return absPath;
    }
    // Different drive/volume: copy, then remove the original.
    fs.copyFileSync(absPath, target);
    fs.unlinkSync(absPath);
  }
  return target;
}

/** A just-uploaded requirement file → its application's folder. */
async function placeApplicationUpload(absPath, applicationId) {
  try {
    return moveInto(absPath, await applicationDir(applicationId));
  } catch (error) {
    console.error("Place application upload error:", error);
    return absPath;
  }
}

/** A just-uploaded Locator Documents file → locators/<Ref No>/documents/ */
async function placeLocatorUpload(absPath, proponentId) {
  try {
    return moveInto(absPath, await locatorDir(proponentId, "documents"));
  } catch (error) {
    console.error("Place locator upload error:", error);
    return absPath;
  }
}

module.exports = {
  LOCATORS_DIR,
  folderName,
  locatorDir,
  applicationDir,
  moveInto,
  placeApplicationUpload,
  placeLocatorUpload,
};
