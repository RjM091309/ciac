const express = require("express");
const { isAuthenticated } = require("../middleware/m_auth");

const router = express.Router();

// Public
router.get("/authentication/signin", (req, res) => {
  const frontend = process.env.FRONTEND_URL;
  if (frontend) return res.redirect(String(frontend).replace(/\/+$/, "") + "/");
  return res.status(404).send("Not found");
});

router.get("/", (req, res) => {
  const frontend = process.env.FRONTEND_URL;
  if (frontend) return res.redirect(String(frontend).replace(/\/+$/, "") + "/");
  return res.status(200).json({ success: true, message: "CIAC API server is running" });
});

// Protected
router.get("/dashboard", isAuthenticated, (req, res) => {
  const frontend = process.env.FRONTEND_URL;
  if (frontend) return res.redirect(String(frontend).replace(/\/+$/, "") + "/dashboard");
  return res.status(404).send("Not found");
});

module.exports = function pageRouter(app) {
  app.use("/api/auth", require("./r_auth"));
  app.use("/api/users", require("./r_users"));
  app.use("/api/roles", require("./r_roles"));
  app.use("/api/proponents", require("./r_proponents"));
  app.use("/api/applications", require("./r_applications"));
  app.use("/api/contracts", require("./r_contracts"));
  app.use("/api/requirements", require("./r_requirements"));
  app.use("/api/requirement-categories", require("./r_requirement_categories"));
  app.use("/api/inspection-types", require("./r_inspection_types"));
  app.use("/api/compliance-types", require("./r_compliance_types"));
  app.use("/", router);
};

