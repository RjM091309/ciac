// Word → PDF through LibreOffice (headless), so the PDF looks like the Word
// file: same fonts, sizes and paper. Needs LibreOffice on the server —
// Windows: install it from libreoffice.org (found in Program Files); Linux:
// apt install libreoffice-writer-nogui. Or point SOFFICE_PATH at
// soffice(.exe). Returns null when it isn't installed.
//
// The lease agreement's font is Arial Narrow (licensed, so not shipped);
// LibreOffice uses Liberation Sans Narrow in its place — same widths, free —
// and that's shipped in server/templates/fonts and handed to every
// conversion, so no server needs it installed. Under the Windows service it
// still prints no text, though (fonts handed to the profile aren't used
// there either), so on Windows install Arial Narrow for all users (the four
// ARIALN*.TTF from an Office PC); without it the PDF swaps in narrowed Arial
// (withoutArialNarrow below).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const JSZip = require("jszip");

const FONTS_DIR = path.join(__dirname, "..", "templates", "fonts");

const CANDIDATES = [
  process.env.SOFFICE_PATH,
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
].filter(Boolean);

function sofficePath() {
  return CANDIDATES.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

// One conversion at a time: LibreOffice is heavy, and requests queue here.
let queue = Promise.resolve();

/** Windows only: Arial Narrow installed for all users. */
function needsArialNarrowSwap() {
  if (process.platform !== "win32") return false;
  return !fs.existsSync(path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "ARIALN.TTF"));
}

/**
 * When Arial Narrow (the lease agreement's font) isn't installed, LibreOffice's
 * stand-in, Liberation Sans Narrow, prints no text at all when LibreOffice
 * runs under the Windows service (session 0) — only shapes like the DRAFT
 * watermark. Arial at 82% width has the same metrics, so the PDF keeps its
 * layout. The Word download is untouched.
 */
async function withoutArialNarrow(docxBytes) {
  if (!needsArialNarrowSwap()) return docxBytes;
  const zip = await JSZip.loadAsync(docxBytes);
  let changed = false;
  for (const name of Object.keys(zip.files).filter((n) => /^word\/.*\.xml$/.test(n))) {
    const xml = await zip.file(name).async("string");
    if (!xml.includes("Arial Narrow")) continue;
    const next = xml
      .replace(/<w:rFonts[^>]*Arial Narrow[^>]*\/>/g, (m) => `${m}<w:w w:val="82"/>`)
      .split("Arial Narrow")
      .join("Arial");
    zip.file(name, next);
    changed = true;
  }
  return changed ? zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) : docxBytes;
}

/** @returns {Promise<Buffer | null>} the PDF, or null without LibreOffice */
function docxToPdf(docxBytes) {
  const soffice = sofficePath();
  if (!soffice) return Promise.resolve(null);
  const run = queue.then(async () => convert(soffice, await withoutArialNarrow(docxBytes)));
  queue = run.catch(() => undefined);
  return run;
}

async function convert(soffice, docxBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ciac-docx-"));
  try {
    const input = path.join(dir, "document.docx");
    fs.writeFileSync(input, docxBytes);
    // Its own profile folder: works under a service account (NSSM) and
    // never collides with a LibreOffice someone has open. Fonts in its
    // user/fonts folder are loaded for this run.
    const profileDir = path.join(dir, "profile");
    const userFonts = path.join(profileDir, "user", "fonts");
    fs.mkdirSync(userFonts, { recursive: true });
    for (const f of fs.existsSync(FONTS_DIR) ? fs.readdirSync(FONTS_DIR) : []) {
      if (/\.(ttf|otf)$/i.test(f)) fs.copyFileSync(path.join(FONTS_DIR, f), path.join(userFonts, f));
    }
    const profile = pathToFileURL(profileDir).href;
    await new Promise((resolve, reject) => {
      execFile(
        soffice,
        [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, input],
        // No Skia: as a Windows service (no desktop session) its rendering
        // can come out without text.
        { timeout: 90_000, windowsHide: true, env: { ...process.env, SAL_DISABLESKIA: "1" } },
        (error, stdout, stderr) => (error ? reject(new Error(`LibreOffice: ${stderr || error.message}`)) : resolve())
      );
    });
    const output = path.join(dir, "document.pdf");
    if (!fs.existsSync(output)) throw new Error("LibreOffice didn't produce a PDF");
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { docxToPdf, sofficePath };
