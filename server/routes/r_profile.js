const express = require("express");
const { rateLimit } = require("express-rate-limit");
const router = express.Router();
const profileController = require("../controller/c_profile");
const { handleAvatarUpload } = require("../lib/avatarStorage");

// My Profile — self-service on the caller's own account only, so no Control
// Panel permission applies; being signed in is enough. Not m_auth's
// isAuthenticated: inside a mounted router req.path lacks the "/api/" prefix
// it checks for, so a signed-out call would get a redirect instead of a 401.
router.use((req, res, next) => {
  if (req.user) return next();
  return res.status(401).json({ success: false, message: "Authentication required" });
});

// 6-digit codes are guessable given enough tries — cap attempts the same way
// the login endpoint is capped (r_auth.js).
const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

router.get("/", profileController.get);
router.put("/", profileController.update);

router.get("/avatar", profileController.getAvatar);
router.post("/avatar", handleAvatarUpload, profileController.uploadAvatar);
router.delete("/avatar", profileController.removeAvatar);

router.post("/totp/setup", totpLimiter, profileController.startTotpSetup);
router.post("/totp/confirm", totpLimiter, profileController.confirmTotpSetup);
router.post("/totp/cancel", profileController.cancelTotpSetup);
router.post("/totp/disable", totpLimiter, profileController.disableTotp);

module.exports = router;
