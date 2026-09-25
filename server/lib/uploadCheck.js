const fs = require("fs");

// Multer only sees the mimetype the browser declares, which the client
// controls. This reads the first bytes of the saved file and checks they
// match that type, so a renamed HTML/script/executable can't be stored as a
// "PDF" or "image". Office formats are checked at the container level (OLE2
// for .doc/.xls, ZIP for .docx/.xlsx) — enough to reject a disguised file.
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

const startsWith = (buf, sig, offset = 0) => sig.every((b, i) => buf[offset + i] === b);
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));

const SIGNATURES = {
  // PDF readers accept a little junk before the header, so look a bit in.
  "application/pdf": (buf) => buf.subarray(0, 1024).includes(Buffer.from("%PDF-")),
  "image/jpeg": (buf) => startsWith(buf, [0xff, 0xd8, 0xff]),
  "image/png": (buf) => startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": (buf) => startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8),
  "application/msword": (buf) => startsWith(buf, OLE2),
  "application/vnd.ms-excel": (buf) => startsWith(buf, OLE2),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (buf) => startsWith(buf, ZIP),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (buf) => startsWith(buf, ZIP),
};

/** Extension to store a file under, from its (verified) mimetype rather than
 * whatever the uploader named it. */
const EXTENSIONS = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

function readHead(filePath, length = 1024) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** True when the saved file's bytes match its declared mimetype. */
function contentMatchesType(filePath, mimetype) {
  const check = SIGNATURES[mimetype];
  if (!check) return false;
  try {
    return check(readHead(filePath));
  } catch {
    return false;
  }
}

/** Express middleware for after a multer `.single()` upload: rejects (and
 * deletes) a file whose content doesn't match its declared type. */
function verifyUploadedFile(req, res, next) {
  const file = req.file;
  if (!file) return next();
  if (contentMatchesType(file.path, file.mimetype)) return next();
  fs.unlink(file.path, () => {});
  const kind = (EXTENSIONS[file.mimetype] || "").slice(1).toUpperCase() || "file";
  return res.status(400).json({
    success: false,
    message: `This file isn't a valid ${kind} — its content doesn't match its type. Please upload the original file.`,
  });
}

module.exports = { verifyUploadedFile, contentMatchesType, EXTENSIONS };
