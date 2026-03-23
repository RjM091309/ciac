const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const { attachUserFromJwt } = require("./middleware/m_auth");
const { initializeDatabase } = require("./config/database");
const Role = require("./models/Role");
const User = require("./models/User");

const app = express();

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

const PORT = process.env.PORT || 3100;
initializeDatabase()
  .then(async () => {
    await Role.ensureSchema();
    await User.ensureSchema();
  })
  .catch(() => {
    // If DB is down, you can still view login page.
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🚀 CIAC server running on http://localhost:${PORT}`);
    });
  });

