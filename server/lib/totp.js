const crypto = require("crypto");
const { generateSecret, generate, verify, generateURI } = require("otplib");
const QRCode = require("qrcode");

// Accept small clock drift between server and the user's phone (±1 period).
const EPOCH_TOLERANCE_SECONDS = 30;

const ENC_PREFIX = "enc:v1:";

function getIssuer() {
  return process.env.TOTP_ISSUER || "3CORE Portal";
}

/**
 * 32-byte key for encrypting TOTP secrets at rest. Prefers TOTP_ENC_KEY
 * (hex or base64, any length -> hashed to 32 bytes); falls back to a value
 * derived from JWT_SECRET so the feature works without extra configuration.
 */
function getEncKey() {
  const raw = process.env.TOTP_ENC_KEY || process.env.JWT_SECRET;
  if (!raw) throw new Error("TOTP_ENC_KEY or JWT_SECRET must be set to store authenticator secrets");
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptSecret(stored) {
  const value = String(stored || "");
  if (!value.startsWith(ENC_PREFIX)) {
    // Plaintext secret (e.g. legacy or manually inserted) — use as-is.
    return value;
  }
  const buf = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function newSecret() {
  return generateSecret();
}

/**
 * Builds the artifacts a user needs to add `secret` to their authenticator app:
 * a scannable QR code and the otpauth:// URI (which also opens Google
 * Authenticator directly when tapped on mobile).
 */
async function buildEnrollment(secret, accountLabel) {
  const otpauthUrl = generateURI({
    issuer: getIssuer(),
    label: String(accountLabel || "user"),
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { secret, otpauthUrl, qrDataUrl };
}

function normalizeToken(token) {
  return String(token || "").replace(/\D/g, "");
}

async function verifyToken(token, plainSecret) {
  const code = normalizeToken(token);
  if (code.length !== 6) return false;
  try {
    const result = await verify({
      secret: plainSecret,
      token: code,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return Boolean(result?.valid);
  } catch {
    return false;
  }
}

module.exports = {
  getIssuer,
  encryptSecret,
  decryptSecret,
  newSecret,
  buildEnrollment,
  verifyToken,
  normalizeToken,
};
