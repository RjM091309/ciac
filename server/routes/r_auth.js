const express = require("express");
const router = express.Router();
const authController = require("../controller/c_auth");

router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.get("/logout", (req, res) => {
  res.clearCookie("jwt");
  const frontend = process.env.FRONTEND_URL;
  if (frontend) return res.redirect(String(frontend).replace(/\/+$/, "") + "/");
  return res.redirect("/");
});
router.get("/check", authController.checkAuth);

module.exports = router;

