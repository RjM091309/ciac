// Word → PDF through LibreOffice (headless), so the PDF looks like the Word
// file: same fonts, sizes and paper. Needs LibreOffice on the server —
// Windows: install it from libreoffice.org (found in Program Files); Linux:
// apt install libreoffice-writer-nogui fonts-crosextra-carlito. Or point
// SOFFICE_PATH at soffice(.exe). Returns null when it isn't installed.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");

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
    // never collides with a LibreOffice someone has open.
    const profile = pathToFileURL(path.join(dir, "profile")).href;
    await new Promise((resolve, reject) => {
      execFile(
        soffice,
        [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, input],
        { timeout: 90_000, windowsHide: true },
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
