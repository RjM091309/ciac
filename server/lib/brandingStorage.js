const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { STORAGE_ROOT } = require("./fileStorage");
const { sniffImageType } = require("./avatarStorage");
const { ASSET_SLOTS, isAssetSlot } = require("./siteSettings");

// Portal Settings images (logos, login background, favicon). Unlike other
// uploads these are served to everyone, signed in or not, so every rule from
// avatarStorage applies and then some: the file's own bytes decide its type
// (never the browser's claim or the file name), only raster formats are
// accepted (no SVG — it can carry script), the stored name is random, and
// the file is served back with that sniffed type only.
const BRANDING_DIR = path.join(STORAGE_ROOT, "branding");
const LARGEST_SLOT_BYTES = Math.max(...Object.values(ASSET_SLOTS).map((s) => s.maxBytes));

const EXT_BY_TYPE = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/x-icon": ".ico" };
const TYPE_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_TYPE).map(([type, ext]) => [ext, type]));
const TYPE_NAMES = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP", "image/x-icon": "ICO" };
const DECLARED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]);

/** ICO: reserved 0, type 1 (icon), at least one image. */
function isIco(buf) {
  return Boolean(buf && buf.length >= 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.readUInt16LE(4) > 0);
}

function sniffBrandingType(buf) {
  return sniffImageType(buf) || (isIco(buf) ? "image/x-icon" : null);
}

const uploadBranding = multer({
  storage: multer.memoryStorage(),
  // Per-slot limits are checked in saveBrandingAsset; this is the backstop.
  limits: { fileSize: LARGEST_SLOT_BYTES, files: 1, fields: 0 },
  fileFilter(req, file, cb) {
    if (DECLARED_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Only PNG, JPG or WebP images (or ICO for the favicon) are allowed."));
  },
}).single("file");

/** Multer error → clean 400 JSON, same shape as the avatar upload. */
function handleBrandingUpload(req, res, next) {
  uploadBranding(req, res, (err) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? `Image is too large (max ${Math.round(LARGEST_SLOT_BYTES / (1024 * 1024))} MB).`
        : err.message || "Upload failed.";
    return res.status(400).json({ success: false, message });
  });
}

const MAX_SIDE = 6000;
const MAX_PIXELS = 24 * 1000 * 1000;

/** { width, height } from a PNG / JPEG / WebP header, or null if unreadable. */
function imageSize(buf, type) {
  try {
    if (type === "image/png") {
      // IHDR is always the first chunk.
      if (buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buf[i + 1];
        // SOF0–SOF15 carry the frame size (C4 DHT, C8 JPG, CC DAC aren't frames).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
          i += marker === 0xff ? 1 : 2;
          continue;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (type === "image/webp") {
      const chunk = buf.subarray(12, 16).toString("ascii");
      if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Largest { width, height } among the images inside an ICO (PNG or BMP
 * entries), or null if any entry is unreadable. */
function icoSize(buf) {
  try {
    const count = buf.readUInt16LE(4);
    if (!count || 6 + count * 16 > buf.length) return null;
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      const offset = buf.readUInt32LE(entry + 12);
      // Image data must come after the directory and fit in the file.
      if (offset < 6 + count * 16 || offset + 16 > buf.length) return null;
      const data = buf.subarray(offset);
      let w;
      let h;
      if (sniffImageType(data) === "image/png") {
        const png = imageSize(data, "image/png");
        if (!png) return null;
        ({ width: w, height: h } = png);
      } else {
        // BITMAPINFOHEADER (40+ bytes): width, then height doubled (image + mask).
        if (data.readUInt32LE(0) < 40) return null;
        w = Math.abs(data.readInt32LE(4));
        h = Math.abs(data.readInt32LE(8)) / 2;
      }
      width = Math.max(width, w);
      height = Math.max(height, h);
    }
    return { width, height };
  } catch {
    return null;
  }
}

function formatBytes(n) {
  return n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.round(n / 1024)} KB`;
}

/** Validates the image against its slot, writes it and returns
 * { fileName, type, size }. Throws a 400 with a message for the admin. */
function saveBrandingAsset(slot, buffer) {
  if (!isAssetSlot(slot)) throw Object.assign(new Error("Unknown image"), { status: 404 });
  const meta = ASSET_SLOTS[slot];
  if (!buffer?.length) throw Object.assign(new Error("Choose an image to upload."), { status: 400 });
  if (buffer.length > meta.maxBytes) {
    throw Object.assign(new Error(`${meta.label} must be ${formatBytes(meta.maxBytes)} or smaller.`), { status: 400 });
  }
  const type = sniffBrandingType(buffer);
  if (!type || !meta.types.includes(type)) {
    const allowed = meta.types.map((t) => TYPE_NAMES[t]).join(", ");
    throw Object.assign(new Error(`That file isn't a valid image for the ${meta.label.toLowerCase()} (${allowed} only).`), { status: 400 });
  }
  // A small file can still declare enormous dimensions (a "decompression
  // bomb"): every visitor's browser would try to decode it, and the login
  // page shows these to everyone. The size is read from the file's header
  // (for an ICO, the largest image inside it).
  {
    const size = type === "image/x-icon" ? icoSize(buffer) : imageSize(buffer, type);
    if (!size) {
      throw Object.assign(new Error("Couldn't read that image's dimensions. Try saving it again as PNG or JPG."), { status: 400 });
    }
    if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) {
      throw Object.assign(
        new Error(`That image is ${size.width}×${size.height} pixels. Use one no larger than ${MAX_SIDE}×${MAX_SIDE} (about 24 megapixels at most).`),
        { status: 400 }
      );
    }
  }
  fs.mkdirSync(BRANDING_DIR, { recursive: true });
  const fileName = `${slot}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${EXT_BY_TYPE[type]}`;
  fs.writeFileSync(path.join(BRANDING_DIR, fileName), buffer);
  return { fileName, type, size: buffer.length };
}

/** Absolute path for a stored file name, or null if it would escape BRANDING_DIR. */
function resolveBrandingAsset(fileName) {
  if (!fileName) return null;
  const resolved = path.resolve(BRANDING_DIR, String(fileName));
  if (path.dirname(resolved) !== BRANDING_DIR) return null;
  return resolved;
}

function brandingContentType(fileName) {
  return TYPE_BY_EXT[path.extname(String(fileName || "")).toLowerCase()] || null;
}

function deleteBrandingAsset(fileName) {
  const abs = resolveBrandingAsset(fileName);
  if (!abs) return;
  fs.promises.unlink(abs).catch(() => {});
}

module.exports = {
  handleBrandingUpload,
  saveBrandingAsset,
  resolveBrandingAsset,
  brandingContentType,
  deleteBrandingAsset,
};
