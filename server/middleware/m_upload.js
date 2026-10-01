const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { EXTENSIONS } = require("../lib/uploadCheck");
const { STORAGE_ROOT, MAX_DOCUMENT_MB } = require("../lib/fileStorage");

// Actual documentary-requirement uploads (BRM-04): files land on disk under
// server/uploads/documents with a generated name; the original name and
// mimetype are kept in the documents table row so downloads can restore them.
// Under the same STORAGE_ROOT as portal uploads (honours STORAGE_DIR), so
// resolveStoredPath() accepts these files for download.
const UPLOAD_ROOT = path.join(STORAGE_ROOT, "documents");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    // Extension from the declared (and later verified) type, never from the
    // uploader's filename — the original name is kept in the documents row.
    const ext = EXTENSIONS[file.mimetype] || "";
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_DOCUMENT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error("Unsupported file type. Upload a PDF, Word, Excel, or image file."));
      return;
    }
    cb(null, true);
  },
});

// Locator Documents tab (Registered Locator panel): documents only — no
// images — and a larger 50 MB cap for scanned contracts/permits. Same disk
// location and naming as `upload`, so downloads resolve the same way.
const DOCUMENT_MAX_MB = MAX_DOCUMENT_MB;
const DOCUMENT_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const documentUpload = multer({
  storage,
  limits: { fileSize: DOCUMENT_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!DOCUMENT_MIME.has(file.mimetype)) {
      cb(new Error("Unsupported file type. Upload a PDF, Word, or Excel document."));
      return;
    }
    cb(null, true);
  },
}).single("file");

/** `documentUpload` with its errors turned into a clean 400 (multer's own
 * "File too large" doesn't say what the limit is). */
function uploadDocumentOnly(req, res, next) {
  documentUpload(req, res, (err) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? `File is too large (max ${DOCUMENT_MAX_MB} MB).`
        : err.message || "Upload failed.";
    return res.status(400).json({ success: false, message });
  });
}

module.exports = { upload, uploadDocumentOnly, DOCUMENT_MAX_MB, UPLOAD_ROOT };
