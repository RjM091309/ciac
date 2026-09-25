const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { EXTENSIONS } = require("../lib/uploadCheck");

// Actual documentary-requirement uploads (BRM-04): files land on disk under
// server/uploads/documents with a generated name; the original name and
// mimetype are kept in the documents table row so downloads can restore them.
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "documents");
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
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error("Unsupported file type. Upload a PDF, Word, Excel, or image file."));
      return;
    }
    cb(null, true);
  },
});

module.exports = { upload, UPLOAD_ROOT };
