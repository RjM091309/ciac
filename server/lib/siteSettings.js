const SiteSetting = require("../models/SiteSetting");
const AuditLog = require("../models/AuditLog");
const { encryptValue, decryptValue } = require("./crypto");
const { diffChanges } = require("./auditDiff");

// Portal Settings catalog — the single list of what an administrator may
// change from the Portal Settings page (settings:portal). Every key the API
// accepts is declared here with its type, limits, default and (where the
// value used to live in .env) the variable the one-time import copies, so:
//   - a key that isn't in this list can never be written,
//   - every value is validated here, on the server, whatever the page sends,
//   - the database is the only source: an unsaved setting is its built-in
//     default. Settings that used to live in server/.env (SMTP_*, LOGIN_*,
//     TOTP_ISSUER) are copied in once by importEnvOnce() below and never read
//     from .env again, so there's one place to look and .env can't quietly
//     override what an admin set.
//
// Deliberately NOT here: database credentials, JWT_SECRET, encryption keys,
// CORS origins and FRONTEND_URL. Changing those from a web page would let a
// hijacked admin session take the whole system over (e.g. point password-reset
// links at a look-alike site), so they stay in server/.env.
//
// Values are read synchronously (getters below) from an in-memory snapshot of
// dbo.site_settings, loaded at startup and reloaded after every save — the
// password check, the lockout counter and the session token all run on every
// request and must not wait on the database for this.

const SECTIONS = {
  branding: { label: "Branding", sensitive: false },
  email: { label: "Email", sensitive: true },
  integrations: { label: "Integrations", sensitive: true },
  security: { label: "Security", sensitive: true },
  renewals: { label: "Renewals", sensitive: false },
  announcements: { label: "Announcements", sensitive: false },
};

// Limits agreed for the Security tab (see docs): at or inside common baselines
// (PCI DSS 8.3.4 lockout ≤ 10 attempts; CIS ≥ 15 min lockout; PCI DSS 8.2.8 /
// NIST 800-63B idle timeout ≤ 15–30 min; OWASP ASVS ≥ 12-char passwords, and
// NIST's "accept at least 64" as the ceiling for a minimum).
const FIELDS = [
  // --- Branding ---
  { section: "branding", name: "portal_name", label: "Portal name", type: "text", max: 40, required: true, default: "BRIDGE+", public: true },
  {
    section: "branding",
    name: "portal_tagline",
    label: "Tagline",
    type: "text",
    max: 160,
    default: "Business Registration & Information Digital Gateway for Enterprises Plus",
    public: true,
  },
  {
    section: "branding",
    name: "login_subtitle",
    label: "Login page message",
    type: "text",
    max: 200,
    default: "Sign in securely to continue to your workspace and dashboard.",
    public: true,
  },
  { section: "branding", name: "tab_title", label: "Browser tab title", type: "text", max: 60, required: true, default: "CIAC", public: true },
  { section: "branding", name: "org_short_name", label: "Organization short name", type: "text", max: 30, required: true, default: "CIAC", public: true },
  {
    section: "branding",
    name: "org_name",
    label: "Organization name",
    type: "text",
    max: 120,
    required: true,
    default: "Clark International Airport Corporation",
    public: true,
  },
  { section: "branding", name: "footer_text", label: "Footer text", type: "text", max: 200, default: "All rights reserved.", public: true },
  { section: "branding", name: "support_email", label: "Support email", type: "email", default: "", public: true },
  { section: "branding", name: "support_phone", label: "Support phone", type: "text", max: 60, default: "", public: true },
  { section: "branding", name: "privacy_url", label: "Privacy policy link", type: "url", max: 300, default: "", public: true },
  { section: "branding", name: "terms_url", label: "Terms of use link", type: "url", max: 300, default: "", public: true },
  // Label in the user's authenticator app (otpauth issuer). Empty = "<org short name> Portal".
  // No ":" — the otpauth label is "issuer:account", and a colon would split it.
  {
    section: "branding",
    name: "totp_issuer",
    label: "Authenticator app name",
    type: "text",
    max: 60,
    pattern: /^[^:]*$/,
    patternMessage: "Authenticator app name can't contain a colon (:).",
    importFrom: "TOTP_ISSUER",
    default: "",
  },
  { section: "branding", name: "header_logo_invert", label: "Invert header logo in dark mode", type: "bool", default: true, public: true },
  { section: "branding", name: "login_logo_invert", label: "Invert login logo in dark mode", type: "bool", default: true, public: true },
  { section: "branding", name: "partner_logo_invert", label: "Invert partner logo in dark mode", type: "bool", default: false, public: true },

  // --- Email (outgoing SMTP) ---
  { section: "email", name: "smtp_host", label: "SMTP server", type: "hostname", importFrom: "SMTP_HOST", default: "" },
  { section: "email", name: "smtp_port", label: "SMTP port", type: "int", min: 1, max: 65535, importFrom: "SMTP_PORT", default: 587 },
  {
    section: "email",
    name: "smtp_security",
    label: "Connection security",
    type: "enum",
    // auto = STARTTLS when the server offers it (how the app has always
    // connected); starttls = refuse to send unless it's encrypted; ssl = TLS
    // from the first byte (usually port 465). No plain-text option: that
    // would send the SMTP password unencrypted.
    options: ["auto", "starttls", "ssl"],
    // SMTP_SECURE=true meant TLS from the first byte; false, STARTTLS when offered.
    importFrom: (e) => (e.SMTP_SECURE === "true" ? "ssl" : e.SMTP_SECURE === "false" ? "auto" : undefined),
    importVars: ["SMTP_SECURE"],
    default: "auto",
  },
  { section: "email", name: "smtp_user", label: "SMTP username", type: "text", max: 254, importFrom: "SMTP_USER", default: "" },
  { section: "email", name: "smtp_pass", label: "SMTP password", type: "secret", max: 512, importFrom: "SMTP_PASS", default: "" },
  // SMTP_FROM was either an address or `"Name" <address>`; the import splits it.
  { section: "email", name: "mail_from_address", label: "From address", type: "email", importFrom: (e) => parseFrom(e.SMTP_FROM).address, importVars: ["SMTP_FROM"], default: "" },
  { section: "email", name: "mail_from_name", label: "From name", type: "text", max: 100, importFrom: (e) => parseFrom(e.SMTP_FROM).name, importVars: ["SMTP_FROM"], default: "" },
  { section: "email", name: "mail_reply_to", label: "Reply-to address", type: "email", default: "" },

  // --- Integrations ---
  {
    section: "integrations",
    name: "google_maps_api_key",
    label: "Google Maps API key",
    type: "secret",
    max: 100,
    pattern: /^[A-Za-z0-9_-]{20,100}$/,
    patternMessage: "That doesn't look like a Google API key (letters, numbers, - and _ only).",
    default: "",
  },

  // --- Security policy ---
  { section: "security", name: "login_max_attempts", label: "Failed sign-in attempts before lockout", type: "int", min: 3, max: 10, importFrom: "LOGIN_MAX_ATTEMPTS", default: 5 },
  { section: "security", name: "login_lockout_minutes", label: "Lockout duration (minutes)", type: "int", min: 15, max: 1440, importFrom: "LOGIN_LOCKOUT_MINUTES", default: 15 },
  { section: "security", name: "idle_timeout_minutes", label: "Idle timeout (minutes)", type: "int", min: 5, max: 30, default: 15, public: true },
  { section: "security", name: "password_min_length", label: "Minimum password length", type: "int", min: 12, max: 64, default: 12, public: true },
  // 0 = passwords never expire.
  { section: "security", name: "password_expiry_days", label: "Password expiry (days)", type: "int", min: 0, max: 365, default: 0 },
  // Off = two-factor stays required: "Turn off 2FA" in My Profile is refused
  // and anyone who had turned it off sets it up again at their next sign-in.
  { section: "security", name: "allow_2fa_opt_out", label: "Let users turn off two-factor authentication", type: "bool", default: true },
  // 0 = keep the audit log forever.
  { section: "security", name: "audit_retention_years", label: "Keep audit log for (years)", type: "int", min: 0, max: 10, default: 0 },
  // Cookie notice shown before the first sign-in (CookieConsent.tsx).
  { section: "security", name: "cookie_title", label: "Cookie notice title", type: "text", max: 80, required: true, default: "We use cookies" },
  {
    section: "security",
    name: "cookie_message",
    label: "Cookie notice message",
    type: "text",
    max: 1000,
    required: true,
    multiline: true,
    default: "This platform utilizes cookies and tracking technologies to optimize browsing functionality, evaluate website traffic patterns, and analyze user acquisition sources.",
  },
  { section: "security", name: "cookie_accept_label", label: "Agree button", type: "text", max: 30, required: true, default: "I agree" },
  { section: "security", name: "cookie_decline_label", label: "Decline button", type: "text", max: 30, required: true, default: "I decline" },
  {
    section: "security",
    name: "cookie_decline_url",
    label: "Decline link",
    type: "url",
    max: 300,
    required: true,
    default: "https://www.ciac.gov.ph",
  },

  // --- Renewals (lib/renewalReminders.js, Permit.js expiring window) ---
  { section: "renewals", name: "expiring_window_months", label: "Expiring window (months)", type: "int", min: 1, max: 12, default: 6 },
  { section: "renewals", name: "reminders_enabled", label: "Email renewal reminders to locators", type: "bool", default: true },
  { section: "renewals", name: "reminder_interval_months", label: "Follow-up every (months)", type: "int", min: 1, max: 6, default: 1 },
  { section: "renewals", name: "stop_after_expiry_months", label: "Stop reminders after expiry (months)", type: "int", min: 0, max: 24, default: 6 },
  { section: "renewals", name: "cc_account_officer", label: "Copy the Account Officer on the reminder email", type: "bool", default: false },

  // --- Announcements & maintenance ---
  { section: "announcements", name: "banner_enabled", label: "Show announcement banner", type: "bool", default: false },
  // Optional heading above the message; empty = a heading for the style (frontend).
  { section: "announcements", name: "banner_title", label: "Banner title", type: "text", max: 80, default: "" },
  { section: "announcements", name: "banner_message", label: "Announcement", type: "text", max: 300, default: "" },
  { section: "announcements", name: "banner_level", label: "Banner style", type: "enum", options: ["info", "warning", "critical"], default: "info" },
  { section: "announcements", name: "banner_starts_at", label: "Show from", type: "datetime", default: "" },
  { section: "announcements", name: "banner_ends_at", label: "Show until", type: "datetime", default: "" },
  { section: "announcements", name: "maintenance_enabled", label: "Maintenance mode", type: "bool", default: false },
  {
    section: "announcements",
    name: "maintenance_message",
    label: "Maintenance message",
    type: "text",
    max: 300,
    default: "The portal is undergoing scheduled maintenance. Please try again later.",
  },
];

/** `"Portal" <no-reply@x.gov.ph>` → { name, address }; a bare address → { address }. */
function parseFrom(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return {};
  const m = /^"?([^"<]*?)"?\s*<([^<>\s]+)>$/.exec(value);
  if (m) return { name: m[1].trim() || undefined, address: m[2] };
  return { address: value };
}

for (const f of FIELDS) f.key = `${f.section}.${f.name}`;
const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

// Replaceable images. `builtin` is what the portal shows when nothing was
// uploaded (files under /public). No SVG anywhere: an SVG is a document that
// can carry script, and these are served to every visitor, signed in or not.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MB = 1024 * 1024;
const ASSET_SLOTS = {
  header_logo: { label: "Header logo", types: IMAGE_TYPES, maxBytes: 2 * MB, builtin: "/images/ciac-logo-only.png" },
  header_logo_dark: { label: "Header logo (dark mode)", types: IMAGE_TYPES, maxBytes: 2 * MB, builtin: null },
  login_logo: { label: "Login logo", types: IMAGE_TYPES, maxBytes: 2 * MB, builtin: "/images/ciac-logo-black.png" },
  login_logo_dark: { label: "Login logo (dark mode)", types: IMAGE_TYPES, maxBytes: 2 * MB, builtin: null },
  partner_logo: { label: "Partner logo", types: IMAGE_TYPES, maxBytes: 2 * MB, builtin: "/images/ciac-brand.png" },
  partner_logo_dark: { label: "Partner logo (dark mode)", types: IMAGE_TYPES, maxBytes: 2 * MB, builtin: "/images/ciac-brand-white.png" },
  login_background: { label: "Login background photo", types: IMAGE_TYPES, maxBytes: 5 * MB, builtin: "/images/leftside-panel-bg.jpg" },
  favicon: { label: "Favicon", types: ["image/png", "image/x-icon"], maxBytes: 512 * 1024, builtin: "/images/favicon/favicon-96x96.png" },
};
const assetKey = (slot) => `asset.${slot}`;
const hasOwn = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
const isSection = (name) => hasOwn(SECTIONS, name);
const isAssetSlot = (slot) => hasOwn(ASSET_SLOTS, slot);

/* ------------------------------ snapshot ------------------------------ */

// key → { raw, isSecret, updatedAt, updatedBy }
let rows = new Map();
let loaded = false;
let loadsStarted = 0;
let newestApplied = 0;

async function load() {
  const seq = ++loadsStarted;
  const list = await SiteSetting.listAll();
  if (seq < newestApplied) return rows; // a newer read already landed
  const next = new Map();
  for (const r of list) {
    next.set(String(r.setting_key), {
      raw: r.setting_value,
      isSecret: Number(r.is_secret) === 1 || r.is_secret === true,
      updatedAt: r.updated_at ? new Date(r.updated_at) : null,
      updatedBy: r.updated_by_username || null,
    });
  }
  rows = next;
  newestApplied = seq;
  loaded = true;
  return rows;
}

/* ------------------------- one-time .env import ------------------------- */

// Written (with the imported values, in the same transaction) the first time
// this database is initialised. Its presence means .env is never read again.
const IMPORT_MARKER_KEY = "system.env_imported_at";
const IMPORT_ACTOR = "system (.env import)";
const LEGACY_ENV_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "LOGIN_MAX_ATTEMPTS",
  "LOGIN_LOCKOUT_MINUTES",
  "TOTP_ISSUER",
];

function importRaw(field, env) {
  if (typeof field.importFrom === "function") return field.importFrom(env);
  const v = env[field.importFrom];
  if (v === undefined || String(v).trim() === "") return undefined;
  // A password is taken exactly as written — spaces at either end can be part of it.
  return field.type === "secret" ? String(v) : String(v).trim();
}

/**
 * Copies the settings that used to come from server/.env into Portal
 * Settings — once per database. Each value goes through the same validation
 * as the admin page (an invalid one is skipped and the default applies), the
 * SMTP password is encrypted like any saved secret, and a value an admin has
 * already saved is never overwritten. The values and the marker are written
 * in one transaction, then the import is recorded in the Audit Log (password
 * masked). Logs variable names only, never values.
 */
async function importEnvOnce(env = process.env) {
  if (rows.has(IMPORT_MARKER_KEY)) return { imported: [], skipped: [], alreadyDone: true };
  const toWrite = {};
  const imported = [];
  const skipped = [];
  const before = {};
  const after = {};
  for (const field of FIELDS) {
    if (!field.importFrom) continue;
    const raw = importRaw(field, env);
    if (raw === undefined) continue;
    const vars = field.importVars || [field.importFrom];
    if (rows.has(field.key)) {
      skipped.push({ field: field.name, vars, reason: "already set in Portal Settings" });
      continue;
    }
    let stored;
    try {
      stored = validateValue(field, field.type === "int" ? raw : String(raw));
    } catch (error) {
      skipped.push({ field: field.name, vars, reason: error.message });
      continue;
    }
    if (stored === "" || stored === null) continue;
    toWrite[field.key] = { value: field.type === "secret" ? encryptValue(stored) : stored, isSecret: field.type === "secret" };
    imported.push(field.name);
    before[field.name] = field.default;
    after[field.name] = coerce(field, stored);
  }
  const at = new Date().toISOString();
  toWrite[IMPORT_MARKER_KEY] = { value: at, isSecret: false };
  // Re-checked in the database under lock: another server may have imported,
  // or an admin saved a field, since this snapshot was read.
  const result = await SiteSetting.saveMany(toWrite, {
    actorId: null,
    actorUsername: IMPORT_ACTOR,
    requireAbsentKey: IMPORT_MARKER_KEY,
    insertOnly: true,
  });
  if (result && result.written === false) return { imported: [], skipped: [], alreadyDone: true };
  if (result?.inserted) {
    for (const name of [...imported]) {
      const key = FIELDS.find((f) => f.name === name && f.importFrom).key;
      if (result.inserted.includes(key)) continue;
      imported.splice(imported.indexOf(name), 1);
      delete before[name];
      delete after[name];
      skipped.push({ field: name, vars: [], reason: "already set in Portal Settings" });
    }
  }

  if (imported.length || skipped.length) {
    await AuditLog.record({
      actorUsername: IMPORT_ACTOR,
      action: "SITE_SETTINGS_IMPORTED",
      entityType: "site_settings",
      details: {
        section_label: "Server configuration (.env)",
        imported,
        skipped: skipped.map(({ field, vars, reason }) => ({ field, vars, reason })),
        changes: diffChanges(before, after, imported),
      },
    });
  }
  if (imported.length) {
    console.log(`[portal settings] Imported ${imported.length} setting(s) from server/.env into Portal Settings: ${imported.join(", ")}.`);
  }
  for (const { vars, reason } of skipped) {
    console.warn(`[portal settings] Not imported from server/.env (${vars.join(", ")}): ${reason}`);
  }
  return { imported, skipped, alreadyDone: false };
}

/** Startup warning for .env lines that no longer do anything. Names only. */
function warnAboutLegacyEnv(env = process.env) {
  const present = LEGACY_ENV_VARS.filter((name) => env[name] !== undefined && String(env[name]).trim() !== "");
  if (!present.length) return present;
  const at = rows.get(IMPORT_MARKER_KEY)?.raw;
  console.warn(
    `[portal settings] ${present.join(", ")} in server/.env ${present.length === 1 ? "is" : "are"} no longer read` +
      `${at ? ` (imported into Portal Settings on ${at})` : ""}. Manage these in System Settings → Portal Settings and delete them from server/.env` +
      `${present.includes("SMTP_PASS") ? " — SMTP_PASS is a password left in plain text there" : ""}.`
  );
  return present;
}

/** Startup step (app.js): creates the table, loads the snapshot, runs the
 * one-time .env import, then re-reads the snapshot every minute so a manual
 * SQL fix is picked up without a restart. Concurrent callers share one run. */
let refreshTimer = null;
let initPromise = null;
let initDone = false;
let initFailedAt = 0;
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await SiteSetting.ensureSchema();
      await load();
      const result = await importEnvOnce();
      if (!result.alreadyDone) await load();
      warnAboutLegacyEnv();
      if (!refreshTimer) {
        refreshTimer = setInterval(() => load().catch((e) => console.error("Portal settings reload failed:", e.message)), 60 * 1000);
        refreshTimer.unref?.();
      }
      initDone = true;
    })().catch((error) => {
      initPromise = null; // retry later (e.g. the DB was still down)
      initFailedAt = Date.now();
      throw error;
    });
  }
  return initPromise;
}

/** Waits for init() (snapshot + one-time import) before a request uses the
 * settings, starting it if needed. After a failure it retries at most once a
 * minute, so a broken database isn't hit again on every request. */
async function ensureLoaded() {
  if (initDone) return;
  if (!initPromise && loaded && Date.now() - initFailedAt < 60 * 1000) return;
  await init();
}

/* ------------------------------- reading ------------------------------- */

function coerce(field, raw) {
  if (raw === undefined || raw === null) return undefined;
  switch (field.type) {
    case "int": {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.trunc(n) : undefined;
    }
    case "bool":
      return raw === true || raw === 1 || String(raw) === "1" || String(raw).toLowerCase() === "true";
    default:
      return String(raw);
  }
}

/** A stored secret that no longer decrypts (APP_ENC_KEY / JWT_SECRET changed)
 * comes back from decryptValue as the ciphertext itself — that must never be
 * used as a password, so it counts as "not set" and the page asks for it again. */
function readSecret(raw) {
  const plain = decryptValue(raw);
  if (typeof raw === "string" && raw.startsWith("enc:v1:") && plain === raw) return { value: undefined, unreadable: true };
  return { value: plain, unreadable: false };
}

function withinLimits(field, value) {
  if (field.type === "int") return value >= field.min && value <= field.max;
  if (field.type === "enum") return field.options.includes(value);
  return true;
}

/** What the field becomes when its saved value is cleared: the built-in default. */
function fallbackValue(field) {
  return field.default;
}

/** Effective value + where it came from ('saved' | 'default'). */
function resolve(key) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) throw new Error(`Unknown portal setting: ${key}`);
  const row = rows.get(key);
  if (row && row.raw !== null && row.raw !== undefined) {
    if (field.type === "secret") {
      const { value, unreadable } = readSecret(row.raw);
      if (!unreadable) return { value, source: "saved" };
      return { value: field.default, source: "default", unreadable: true };
    }
    const value = coerce(field, row.raw);
    if (value !== undefined && withinLimits(field, value)) return { value, source: "saved" };
  }
  return { value: field.default, source: "default" };
}

const get = (key) => resolve(key).value;

function assetFile(slot) {
  const row = rows.get(assetKey(slot));
  return row?.raw ? String(row.raw) : null;
}

/* ------------------------ typed getters (hot paths) ----------------------- */

const orgShortName = () => get("branding.org_short_name") || "CIAC";

const getters = {
  portalName: () => get("branding.portal_name"),
  orgShortName,
  orgName: () => get("branding.org_name"),
  /** The portal's display name in emails, certificates and the authenticator
   * — the "Portal name" set in Branding (e.g. "BRIDGE+"), falling back to
   * "<org short name> Portal" when that field is blank. */
  portalLabel: () => get("branding.portal_name") || `${orgShortName()} Portal`,
  /** "CIAC Locator Portal" — the name locator-facing emails use. */
  locatorPortalLabel: () => `${orgShortName()} Locator Portal`,
  supportEmail: () => get("branding.support_email") || "",
  supportPhone: () => get("branding.support_phone") || "",
  lockout: () => ({ maxAttempts: get("security.login_max_attempts"), lockoutMinutes: get("security.login_lockout_minutes") }),
  idleTimeoutSeconds: () => get("security.idle_timeout_minutes") * 60,
  passwordMinLength: () => get("security.password_min_length"),
  passwordExpiryDays: () => get("security.password_expiry_days"),
  allow2faOptOut: () => Boolean(get("security.allow_2fa_opt_out")),
  auditRetentionYears: () => get("security.audit_retention_years"),
  renewals: () => ({
    expiringWindowMonths: get("renewals.expiring_window_months"),
    remindersEnabled: Boolean(get("renewals.reminders_enabled")),
    reminderIntervalMonths: get("renewals.reminder_interval_months"),
    stopAfterExpiryMonths: get("renewals.stop_after_expiry_months"),
    ccAccountOfficer: Boolean(get("renewals.cc_account_officer")),
  }),
  // An empty saved message falls back to the default, so a blocked sign-in
  // (and the login page) always has something to say.
  maintenance: () => ({
    enabled: Boolean(get("announcements.maintenance_enabled")),
    message: String(get("announcements.maintenance_message") || "").trim() || FIELD_BY_KEY.get("announcements.maintenance_message").default,
  }),
  googleMapsApiKey: () => get("integrations.google_maps_api_key") || "",
  /** Label shown in the authenticator app: the saved "Authenticator app
   * name", else "<org short name> Portal". Only new enrollments pick up a
   * change — phones keep the label they scanned. */
  totpIssuer: () => get("branding.totp_issuer") || `${orgShortName()} Portal`,
};

/** Plain-text "contact CIAC" phrase for emails and messages, with the
 * support address/phone when one is configured. */
function contactPhrase() {
  const email = get("branding.support_email");
  const phone = get("branding.support_phone");
  const via = [email, phone].filter(Boolean).join(" or ");
  return via ? `contact ${orgShortName()} at ${via}` : `contact ${orgShortName()}`;
}
getters.contactPhrase = contactPhrase;

/** nodemailer transport options + from/reply-to, from the effective values. */
function mailConfig(overrides = {}) {
  const v = (name) => (name in overrides ? overrides[name] : get(`email.${name}`));
  const security = v("smtp_security");
  const user = v("smtp_user");
  const fromAddress = v("mail_from_address") || user || "";
  // No From name saved: show the portal's name ("CIAC Portal") in inboxes.
  const fromName = v("mail_from_name") || getters.portalLabel();
  return {
    transport: {
      host: v("smtp_host") || undefined,
      port: Number(v("smtp_port")) || 587,
      secure: security === "ssl",
      requireTLS: security === "starttls",
      auth: user ? { user, pass: v("smtp_pass") } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    },
    from: fromAddress ? { name: fromName, address: fromAddress } : undefined,
    replyTo: v("mail_reply_to") || undefined,
    configured: Boolean(v("smtp_host") && user),
  };
}

/* ---------------------------- public payloads ---------------------------- */

function isBannerActive(now = new Date()) {
  if (!get("announcements.banner_enabled")) return false;
  if (!String(get("announcements.banner_message") || "").trim()) return false;
  const starts = get("announcements.banner_starts_at");
  const ends = get("announcements.banner_ends_at");
  if (starts && new Date(starts) > now) return false;
  if (ends && new Date(ends) <= now) return false;
  return true;
}

function assetUrl(slot) {
  const file = assetFile(slot);
  return file ? `/api/site-settings/assets/${slot}?v=${encodeURIComponent(file)}` : null;
}

/** Everything the login page and every signed-in page need to render the
 * portal's name, images and rules — nothing secret. Served without sign-in. */
function publicSettings() {
  const branding = {};
  for (const f of FIELDS) if (f.public && f.section === "branding") branding[f.name] = get(f.key);
  const logo = (slot, invertKey) => ({
    url: assetUrl(slot),
    dark_url: assetUrl(`${slot}_dark`),
    builtin: ASSET_SLOTS[slot].builtin,
    builtin_dark: ASSET_SLOTS[`${slot}_dark`].builtin,
    invert: Boolean(get(invertKey)),
  });
  const faviconFile = assetFile("favicon");
  return {
    branding,
    assets: {
      header_logo: logo("header_logo", "branding.header_logo_invert"),
      login_logo: logo("login_logo", "branding.login_logo_invert"),
      partner_logo: logo("partner_logo", "branding.partner_logo_invert"),
      login_background: { url: assetUrl("login_background"), builtin: ASSET_SLOTS.login_background.builtin },
      favicon: {
        url: assetUrl("favicon"),
        type: faviconFile && faviconFile.endsWith(".ico") ? "image/x-icon" : "image/png",
      },
    },
    security: {
      idle_timeout_minutes: get("security.idle_timeout_minutes"),
      password_min_length: get("security.password_min_length"),
      authenticator_name: getters.totpIssuer(),
      // My Profile hides "Turn off 2FA" when this is false.
      allow_2fa_opt_out: getters.allow2faOptOut(),
    },
    cookie_notice: {
      title: get("security.cookie_title"),
      message: get("security.cookie_message"),
      accept_label: get("security.cookie_accept_label"),
      decline_label: get("security.cookie_decline_label"),
      decline_url: get("security.cookie_decline_url"),
    },
    banner: isBannerActive()
      ? {
          title: get("announcements.banner_title") || "",
          message: get("announcements.banner_message"),
          level: get("announcements.banner_level"),
          ends_at: get("announcements.banner_ends_at") || null,
        }
      : null,
    maintenance: getters.maintenance(),
  };
}

function maskKey(value) {
  const s = String(value || "");
  return s ? `…${s.slice(-4)}` : "";
}

/** Latest updated_at among a section's keys — the version a save must match. */
function sectionVersion(section) {
  let latest = null;
  for (const f of FIELDS) {
    if (f.section !== section) continue;
    const at = rows.get(f.key)?.updatedAt;
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

function sectionUpdatedBy(section) {
  let latest = null;
  let by = null;
  for (const f of FIELDS) {
    if (f.section !== section) continue;
    const row = rows.get(f.key);
    if (row?.updatedAt && (!latest || row.updatedAt > latest)) {
      latest = row.updatedAt;
      by = row.updatedBy;
    }
  }
  return by;
}

/** The admin page's view: every field with its effective value and source,
 * limits and default. Secrets are never included — only whether one is set
 * (and, for the API key, its last four characters). */
function adminSettings() {
  const sections = {};
  for (const [name, meta] of Object.entries(SECTIONS)) {
    const version = sectionVersion(name);
    sections[name] = {
      label: meta.label,
      sensitive: meta.sensitive,
      version: version ? version.toISOString() : null,
      updated_at: version ? version.toISOString() : null,
      updated_by: sectionUpdatedBy(name),
      fields: {},
    };
  }
  for (const f of FIELDS) {
    const r = resolve(f.key);
    const entry = {
      label: f.label,
      type: f.type,
      source: r.source,
      default: f.type === "secret" ? null : f.default,
      reset_value: f.type === "secret" ? null : fallbackValue(f),
      ...(f.min !== undefined ? { min: f.min } : {}),
      ...(f.max !== undefined ? { max: f.max } : {}),
      ...(f.options ? { options: f.options } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.multiline ? { multiline: true } : {}),
    };
    if (f.type === "secret") {
      entry.value = null;
      entry.is_set = Boolean(r.value);
      entry.unreadable = Boolean(r.unreadable);
      if (f.name === "google_maps_api_key") entry.hint = maskKey(r.value);
    } else {
      entry.value = r.value;
    }
    sections[f.section].fields[f.name] = entry;
  }
  const assets = {};
  for (const [slot, meta] of Object.entries(ASSET_SLOTS)) {
    const row = rows.get(assetKey(slot));
    assets[slot] = {
      label: meta.label,
      url: assetUrl(slot),
      builtin: meta.builtin,
      types: meta.types,
      max_bytes: meta.maxBytes,
      updated_at: row?.raw && row.updatedAt ? row.updatedAt.toISOString() : null,
      updated_by: row?.raw ? row.updatedBy : null,
    };
  }
  return { sections, assets, mail_configured: mailConfig().configured };
}

/* ------------------------------ validation ------------------------------ */

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const EMAIL_RE = /^[^\s@<>"'(),;:\\[\]]+@[^\s@<>"'(),;:\\[\]]+\.[^\s@<>"'(),;:\\[\]]+$/;
const HOST_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function isValidHostname(value) {
  if (value.length > 253) return false;
  return value.split(".").every((label) => HOST_LABEL_RE.test(label));
}

/** Validated, normalized value to store for `field` (null = reset to default).
 * Throws a 400 with a message written for the admin. */
function validateValue(field, input) {
  if (input === null) return null;
  const label = field.label;
  switch (field.type) {
    case "bool":
      if (typeof input !== "boolean") throw invalid(`${label}: expected on or off.`);
      return input ? "1" : "0";
    case "int": {
      const n = typeof input === "number" ? input : Number(String(input).trim());
      if (!Number.isInteger(n)) throw invalid(`${label} must be a whole number.`);
      if (n < field.min || n > field.max) throw invalid(`${label} must be between ${field.min} and ${field.max}.`);
      return String(n);
    }
    case "enum": {
      const s = String(input);
      if (!field.options.includes(s)) throw invalid(`${label}: choose one of the listed options.`);
      return s;
    }
    case "datetime": {
      const s = String(input).trim();
      if (!s) return "";
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) throw invalid(`${label} isn't a valid date and time.`);
      return d.toISOString();
    }
    default:
      break;
  }
  if (typeof input !== "string") throw invalid(`${label} must be text.`);
  // Line breaks here would end up in email headers (From/Reply-To/subjects)
  // or single-line page text — refuse every control character outright.
  if (CONTROL_CHARS.test(input)) throw invalid(`${label} can't contain line breaks or control characters.`);
  const s = field.type === "secret" ? input : input.trim();
  if (field.max && s.length > field.max) throw invalid(`${label} must be ${field.max} characters or fewer.`);
  if (field.required && !s) throw invalid(`${label} can't be empty.`);
  if (!s) return "";
  if (field.type === "email" && (s.length > 254 || !EMAIL_RE.test(s))) throw invalid(`${label} isn't a valid email address.`);
  if (field.type === "hostname" && !isValidHostname(s)) throw invalid(`${label} must be a host name or IP address (e.g. smtp.example.com).`);
  if (field.type === "url") {
    // https only: these become links on the login page, so no javascript:,
    // data: or plain-http targets.
    let parsed = null;
    try {
      parsed = new URL(s);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      throw invalid(`${label} must be a full https:// link (e.g. https://www.example.com/privacy).`);
    }
    return parsed.toString();
  }
  if (field.pattern && !field.pattern.test(s)) throw invalid(field.patternMessage || `${label} isn't in the expected format.`);
  return s;
}

/**
 * Validates a section save. `input` is { name: value } for just the fields
 * the admin changed (null = reset to default; for a secret, an omitted or ""
 * value = keep the current one). Returns the rows to write plus before/after
 * snapshots for the audit diff, or throws a 400.
 */
function prepareSectionUpdate(section, input) {
  if (!isSection(section)) throw Object.assign(new Error("Unknown settings section"), { status: 404 });
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Nothing to save.");

  const toWrite = {};
  const before = {};
  const after = {};
  const next = {}; // effective values after this save, for cross-field rules
  for (const f of FIELDS) {
    if (f.section !== section) continue;
    const current = resolve(f.key);
    before[f.name] = current.value;
    next[f.name] = current.value;
  }

  for (const [name, raw] of Object.entries(input)) {
    const field = FIELD_BY_KEY.get(`${section}.${name}`);
    if (!field) throw invalid(`Unknown setting "${String(name).slice(0, 60)}".`);
    if (field.type === "secret" && (raw === undefined || raw === "")) continue;
    const stored = validateValue(field, raw);
    toWrite[field.key] = {
      value: stored === null ? null : field.type === "secret" && stored ? encryptValue(stored) : stored,
      isSecret: field.type === "secret",
    };
    if (stored === null) {
      // Back to the built-in default.
      next[name] = fallbackValue(field);
    } else {
      next[name] = coerce(field, stored);
    }
  }

  if (section === "email") {
    // The stored SMTP password must never follow a changed server or
    // username on its own: that's exactly how a hijacked session would send
    // it to a server the attacker controls. Changing either needs the
    // password typed again (clearing it also works — then nothing is sent).
    const serverChanged = next.smtp_host !== before.smtp_host || next.smtp_user !== before.smtp_user;
    const passTyped = typeof input.smtp_pass === "string" && input.smtp_pass !== "";
    if (serverChanged && next.smtp_pass && !passTyped) {
      throw invalid("Re-enter the SMTP password when you change the SMTP server or username.");
    }
  }
  if (section === "announcements") {
    if (next.banner_enabled && !String(next.banner_message || "").trim()) {
      throw invalid("Write the announcement before turning the banner on.");
    }
    // A "Show until" that has already passed would hide the banner the moment
    // it's saved. Only checked when it's part of this save — a banner that
    // expired on its own mustn't block saving the rest of the tab.
    if (Object.prototype.hasOwnProperty.call(input, "banner_ends_at") && next.banner_ends_at && new Date(next.banner_ends_at) <= new Date()) {
      throw invalid('"Show until" is already in the past. Pick a later date and time, or leave it empty to show the banner until you turn it off.');
    }
    if (next.banner_starts_at && next.banner_ends_at && new Date(next.banner_ends_at) <= new Date(next.banner_starts_at)) {
      throw invalid('"Show until" must be after "Show from".');
    }
  }

  for (const name of Object.keys(next)) after[name] = next[name];
  return { toWrite, before, after, changedFields: Object.keys(input) };
}

async function saveSection(section, input, { actorId, actorUsername, version }) {
  await init(); // already resolved once settings are loaded; retries a failed start
  const prepared = prepareSectionUpdate(section, input);
  if (!Object.keys(prepared.toWrite).length) return { ...prepared, nothingChanged: true };
  const versionKeys = FIELDS.filter((f) => f.section === section).map((f) => f.key);
  await SiteSetting.saveMany(prepared.toWrite, { actorId, actorUsername, versionKeys, expectedVersion: version ?? null });
  await load();
  return prepared;
}

async function setAssetFile(slot, fileName, { actorId, actorUsername }) {
  if (!isAssetSlot(slot)) throw Object.assign(new Error("Unknown image"), { status: 404 });
  await init();
  const previous = assetFile(slot);
  await SiteSetting.saveMany({ [assetKey(slot)]: { value: fileName, isSecret: false } }, { actorId, actorUsername });
  await load();
  return previous;
}

module.exports = {
  SECTIONS,
  FIELDS,
  ASSET_SLOTS,
  IMPORT_MARKER_KEY,
  importEnvOnce,
  warnAboutLegacyEnv,
  parseFrom,
  isSection,
  isAssetSlot,
  getters,
  init,
  ensureLoaded,
  reload: load,
  get,
  resolve,
  assetFile,
  mailConfig,
  publicSettings,
  adminSettings,
  prepareSectionUpdate,
  validateValue,
  saveSection,
  setAssetFile,
};
