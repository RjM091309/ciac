const express = require("express");
const { isAuthenticated } = require("../middleware/m_auth");

const router = express.Router();

// Public
router.get("/authentication/signin", (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  return res.render("authentication/signin", {
    title: "Sign In",
    subTitle: "CIAC Login",
    FRONTEND_URL: process.env.FRONTEND_URL || "",
    layout: "../views/layout/layout2",
  });
});

router.get("/", (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  return res.redirect("/authentication/signin");
});

// Protected
router.get("/dashboard", isAuthenticated, (req, res) => {
  return res.render("index", { title: "Dashboard", subTitle: "CIAC Overview" });
});

module.exports = function pageRouter(app) {
  app.use("/api/auth", require("./r_auth"));
  app.use("/api/users", require("./r_users"));
  app.use("/api/roles", require("./r_roles"));
  app.use("/", router);
};

