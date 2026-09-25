// msnodesqlv8 (the Windows Trusted-Connection ODBC driver used below) runs
// its blocking calls on libuv's threadpool — the same pool Node uses for
// fs/crypto/dns. That pool defaults to 4 threads, which a single page load
// can saturate outright (e.g. Assessment's list + summary + evaluators +
// detail firing in parallel is exactly 4 concurrent DB calls) — any query
// queued behind those then times out ("Query timeout expired") even though
// the database itself isn't slow. Must be set before any async I/O touches
// libuv, so this has to run before every other require below.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || "16";

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const { attachUserFromJwt } = require("./middleware/m_auth");
const { csrfGuard } = require("./middleware/m_csrf");
const { publicErrorMessage } = require("./lib/httpError");
const { initializeDatabase } = require("./config/database");
const Role = require("./models/Role");
const User = require("./models/User");
const TypeOfContract = require("./models/TypeOfContract");
const AccountOfficer = require("./models/AccountOfficer");
const Stockholder = require("./models/Stockholder");
const ContactPerson = require("./models/ContactPerson");
const Signatory = require("./models/Signatory");
const FinancialTerms = require("./models/FinancialTerms");
const Investment = require("./models/Investment");
const Building = require("./models/Building");
const LandUse = require("./models/LandUse");
const Contract = require("./models/Contract");
const UserSession = require("./models/UserSession");
const { dropUnusedLegacyTables } = require("./config/legacyTables");

const app = express();

// Requests normally reach this server through a proxy (Vite's /api proxy in
// dev, a reverse proxy in production), so req.ip would be the proxy's own
// address. Trusting X-Forwarded-For only when the connection comes from that
// proxy gives the real client IP for the audit log. The default "loopback"
// covers a proxy on the same machine; set TRUST_PROXY (an Express
// "trust proxy" value: IP/subnet list, hop count, or true/false) when the
// proxy runs elsewhere. Avoid `true` unless this port is reachable only
// through the proxy — otherwise any client can fake its IP with the header.
function parseTrustProxy(value) {
  if (value === undefined || value === "") return "loopback";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

// Baseline HTTP security headers (X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security, Referrer-Policy, etc.). CSP is left to helmet's
// off-by-default here — this server only ever emits JSON plus a couple of
// static assets under server/public, not the real SPA (that's Vite/the
// frontend's own build), so a same-origin CSP tuned for a full app markup
// isn't the right fit for what this process actually serves.
app.use(helmet({ contentSecurityPolicy: false }));

function collectAllowedOrigins() {
  const envOrigins = [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_ORIGIN,
    process.env.FRONTEND_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const defaults = ["http://localhost:2500", "http://localhost:5173"];
  return Array.from(new Set([...defaults, ...envOrigins]));
}

const allowedOrigins = collectAllowedOrigins();

// Allow frontend clients to call API with cookies.
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (curl/postman/server-to-server).
      if (!origin) return callback(null, true);
      const normalizedOrigin = String(origin).trim().replace(/\/+$/, "");
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CSRF: reject state-changing /api requests whose Origin isn't one CORS
// already trusts (see server/middleware/m_csrf.js).
app.use(csrfGuard(allowedOrigins));

// Attach req.user if JWT cookie is present
app.use(attachUserFromJwt);

// Static files
app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/images", express.static(path.join(__dirname, "public", "images")));
app.use("/js", express.static(path.join(__dirname, "public", "js")));

// Routes
const pageRouter = require("./routes/routes");
pageRouter(app);

// Multer (file upload) errors — size limit, bad mimetype — reach here via
// next(err) before any controller's own try/catch runs. Every other route
// handles its own errors, so this only needs to cover upload failures.
app.use((err, req, res, next) => {
  if (!err) return next();
  if (req.path.startsWith("/api/")) {
    const status = err.name === "MulterError" || /unsupported file type/i.test(err.message || "") ? 400 : 500;
    // Multer's own messages ("File too large") are meant for the user.
    const message = err.name === "MulterError" ? err.message : publicErrorMessage(err, "Upload failed");
    return res.status(status).json({ success: false, message });
  }
  return next(err);
});

const PORT = process.env.PORT || 3100;
// Listen immediately so Vite's /api proxy is not ECONNREFUSED while SQL
// connect/schema (or a 15s timeout) is still running.
app.listen(PORT, () => {
  console.log(`🚀 CIAC server running on http://localhost:${PORT}`);
});

initializeDatabase()
  .then(async (pool) => {
    if (!pool) return;
    // Every step is idempotent and independent: one failing must not stop the
    // rest from being created (the old single try/catch swallowed the first error
    // and silently skipped everything after it). Order matters only where noted.
    const steps = [
      ["roles", () => Role.ensureSchema()],
      ["users (+ departments, users.department_id)", () => User.ensureSchema()], // after roles
      ["type of contract", () => TypeOfContract.ensureSchema()],
      ["contracts (+ contract_type_id FK)", () => Contract.ensureSchema()], // after type of contract
      ["legacy account officers", () => AccountOfficer.applyLegacyOfficerDefaults()], // after users + departments
      ["stockholder", () => Stockholder.ensureSchema()], // creates proponents first (FK)
      ["contact person", () => ContactPerson.ensureSchema()],
      ["signatory", () => Signatory.ensureSchema()],
      ["financial terms (+ legacy column carry-over)", () => FinancialTerms.ensureSchema()],
      ["investment", () => Investment.ensureSchema()],
      ["building", () => Building.ensureSchema()],
      ["land use", () => LandUse.ensureSchema()],
      ["drop unused legacy tables", () => dropUnusedLegacyTables()], // see config/legacyTables.js
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (error) {
        console.error(`Schema step failed (${name}):`, error.message);
      }
    }
    // Closes sessions that expired or were revoked without a sign-out, and
    // logs each one to the audit trail (see models/UserSession.js).
    UserSession.startSweeper();
  })
  .catch(() => {
    // If DB is down, you can still view login page.
  });

