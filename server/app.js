const express = require("express");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
const cors = require("cors");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const { attachUserFromJwt } = require("./middleware/m_auth");
const { initializeDatabase } = require("./config/database");
const Role = require("./models/Role");
const User = require("./models/User");

const app = express();

// Allow Vite frontend to call API with cookies
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:2500";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
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

// View engine
app.use(expressLayouts);
app.set("layout", "./layout/layout2");
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

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

