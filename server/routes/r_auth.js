const express = require("express");
const router = express.Router();
const authController = require("../controller/c_auth");

router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.get("/logout", (req, res) => {
  res.clearCookie("jwt");
  res.redirect("/authentication/signin");
});
router.get("/check", authController.checkAuth);

module.exports = router;

