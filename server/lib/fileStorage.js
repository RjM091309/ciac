const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

// Root directory for uploaded documents. Override with STORAGE_DIR in .env.
const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, "..", "uploads");

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
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
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname || "").toLowerCase() || "";
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED[file.mimetype]) return cb(null, true);
  return cb(new Error("Only PDF, JPG, or PNG files are allowed."));
}

const uploadDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
}).single("file");

/** Multer error -> clean 400 JSON; anything else -> next(err). */
function handleUpload(req, res, next) {
  uploadDocument(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)." : `Upload error: ${err.message}`;
      return res.status(400).json({ success: false, message });
    }
    return res.status(400).json({ success: false, message: err.message || "Upload failed." });
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

module.exports = {
  STORAGE_ROOT,
  MAX_FILE_BYTES,
  handleUpload,
  resolveStoredPath,
  relativeStoragePath,
};
