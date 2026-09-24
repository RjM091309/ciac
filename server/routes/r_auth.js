const express = require("express");
const { rateLimit } = require("express-rate-limit");
const router = express.Router();
const authController = require("../controller/c_auth");

// Per-account lockout (Auth.js) already stops brute-forcing a single known
// username; these IP-based limits close the other gap — spraying one
// password across many usernames, or hammering the reset-email endpoint to
// spam a target's inbox — neither of which trips a single account's lockout.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts from this device. Please try again later." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many password reset requests. Please try again later." },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

router.post("/login", loginLimiter, authController.login);
router.post("/logout", authController.logout);
router.post("/forgot-password", forgotPasswordLimiter, authController.forgotPassword);
router.post("/reset-password", resetPasswordLimiter, authController.resetPassword);
router.get("/logout", (req, res) => {
  res.clearCookie("jwt");
  const frontend = process.env.FRONTEND_URL;
  if (frontend) return res.redirect(String(frontend).replace(/\/+$/, "") + "/");
  return res.redirect("/");
});
router.get("/check", authController.checkAuth);
router.post("/refresh", authController.refresh);
router.post("/tab-closed", authController.tabClosed);

module.exports = router;
