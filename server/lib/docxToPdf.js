// Word → PDF through LibreOffice (headless), so the PDF looks like the Word
// file: same fonts, sizes and paper. Needs LibreOffice on the server —
// Windows: install it from libreoffice.org (found in Program Files); Linux:
// apt install libreoffice-writer-nogui. Or point SOFFICE_PATH at
// soffice(.exe). Returns null when it isn't installed.
//
// The lease agreement's font is Arial Narrow (licensed, so not shipped);
// LibreOffice uses Liberation Sans Narrow in its place — same widths, free —
// and that's shipped in server/templates/fonts and handed to every
// conversion, so no server needs it installed.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");

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

/** @returns {Promise<Buffer | null>} the PDF, or null without LibreOffice */
function docxToPdf(docxBytes) {
  const soffice = sofficePath();
  if (!soffice) return Promise.resolve(null);
  const run = queue.then(() => convert(soffice, docxBytes));
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
