const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { publicErrorMessage } = require("./httpError");
const { verifyUploadedFile } = require("./uploadCheck");

// Root directory for uploaded documents. Override with STORAGE_DIR in .env.
const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, "..", "uploads");

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED = {
  "application/pdf": ".pdf",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appDir(applicationId) {
  const id = String(Number(applicationId) || "misc");
  return ensureDir(path.join(STORAGE_ROOT, id));
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      cb(null, appDir(req.params.id));
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const ext = ALLOWED[file.mimetype] || "";
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED[file.mimetype]) return cb(null, true);
  return cb(new Error("Only PDF files are allowed."));
}

const uploadDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
}).single("file");

/** Multer error -> clean 400 JSON; anything else -> next(err). */
function handleUpload(req, res, next) {
  uploadDocument(req, res, (err) => {
    if (!err) return verifyUploadedFile(req, res, next);
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)." : `Upload error: ${err.message}`;
      return res.status(400).json({ success: false, message });
    }
    return res.status(400).json({ success: false, message: publicErrorMessage(err, "Upload failed.") });
  });
}

/** Absolute path on disk for a stored document row's storage_path. */
function resolveStoredPath(storagePath) {
  if (!storagePath) return null;
  // Stored as "<applicationId>/<filename>" relative to STORAGE_ROOT.
  const resolved = path.resolve(STORAGE_ROOT, storagePath);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep) && resolved !== STORAGE_ROOT) return null;
  return resolved;
}

function relativeStoragePath(absPath) {
  return path.relative(STORAGE_ROOT, absPath).split(path.sep).join("/");
}

/** Content-Disposition value for `name`. Node rejects a header holding
 * non-Latin-1 characters (a locator's "Ñiño Permit.pdf" or an emoji), so the
 * plain filename gets an ASCII stand-in and the real name goes in the
 * RFC 5987 filename* parameter, which browsers prefer when present. */
function contentDisposition(type, name) {
  const clean = String(name || "file").replace(/[\r\n"\\]/g, "").trim() || "file";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  if (ascii === clean) return `${type}; filename="${clean}"`;
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

module.exports = {
  STORAGE_ROOT,
  contentDisposition,
  MAX_FILE_BYTES,
  handleUpload,
  resolveStoredPath,
  relativeStoragePath,
};
