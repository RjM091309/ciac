const crypto = require("crypto");

// Generic AES-256-GCM helper for encrypting sensitive columns at rest
// (e.g. proponents.tin) — same scheme as server/lib/totp.js uses for
// authenticator secrets, factored out so other fields can reuse it.
const ENC_PREFIX = "enc:v1:";

function getEncKey() {
  const raw = process.env.APP_ENC_KEY || process.env.JWT_SECRET;
  if (!raw) throw new Error("APP_ENC_KEY or JWT_SECRET must be set to encrypt sensitive data");
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptValue(plain) {
  if (plain === null || plain === undefined || plain === "") return plain ?? null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptValue(stored) {
  if (stored === null || stored === undefined) return stored ?? null;
  const value = String(stored);
  if (!value.startsWith(ENC_PREFIX)) {
    // Plaintext (legacy row not yet migrated, or manually inserted) — use as-is.
    return value;
  }
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getEncKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // Corrupt/foreign ciphertext (e.g. key rotated) — surface as-is rather
    // than throwing and taking down an entire list endpoint over one row.
    return value;
  }
}

module.exports = { encryptValue, decryptValue };
