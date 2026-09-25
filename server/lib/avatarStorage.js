const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { STORAGE_ROOT } = require("./fileStorage");

// Profile photos (My Profile). The browser already crops and shrinks the
// photo to a small square before uploading, so the limit here is only a
// backstop against someone posting a raw file straight to the endpoint.
const AVATAR_DIR = path.join(STORAGE_ROOT, "avatars");
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

const EXT_BY_TYPE = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const TYPE_BY_EXT = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** The file's own first bytes decide its type — the browser-sent mimetype
 * and name are just claims, and this file is later served back as an image. */
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (EXT_BY_TYPE[file.mimetype]) return cb(null, true);
    return cb(new Error("Only JPG, PNG or WebP images are allowed."));
  },
}).single("avatar");

/** Multer error -> clean 400 JSON, same shape as fileStorage.handleUpload. */
function handleAvatarUpload(req, res, next) {
  uploadAvatar(req, res, (err) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "Photo is too large (max 5 MB)."
        : err.message || "Upload failed.";
    return res.status(400).json({ success: false, message });
  });
}

/** Writes the photo to disk and returns its file name (what users.avatar_path holds). */
function saveAvatar(userId, buffer) {
  const type = sniffImageType(buffer);
  if (!type) throw Object.assign(new Error("That file isn't a valid JPG, PNG or WebP image."), { status: 400 });
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const fileName = `${Number(userId)}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${EXT_BY_TYPE[type]}`;
  fs.writeFileSync(path.join(AVATAR_DIR, fileName), buffer);
  return fileName;
}

/** Absolute path for a stored file name, or null if it would escape AVATAR_DIR. */
function resolveAvatar(fileName) {
  if (!fileName) return null;
  const resolved = path.resolve(AVATAR_DIR, String(fileName));
  if (path.dirname(resolved) !== AVATAR_DIR) return null;
  return resolved;
}

function avatarContentType(fileName) {
  return TYPE_BY_EXT[path.extname(String(fileName || "")).toLowerCase()] || "application/octet-stream";
}

function deleteAvatar(fileName) {
  const abs = resolveAvatar(fileName);
  if (!abs) return;
  fs.promises.unlink(abs).catch(() => {});
}

module.exports = {
  handleAvatarUpload,
  saveAvatar,
  resolveAvatar,
  avatarContentType,
  deleteAvatar,
};
