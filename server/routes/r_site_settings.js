const express = require("express");
const { rateLimit } = require("express-rate-limit");
const router = express.Router();
const controller = require("../controller/c_site_settings");
const { requireRole } = require("../middleware/m_auth");
const { handleBrandingUpload } = require("../lib/brandingStorage");

// Portal Settings (settings:portal).
//
// Public — the login page needs the portal's name, images and rules before
// anyone signs in. These return nothing secret (lib/siteSettings.js
// publicSettings()).
router.get("/public", controller.getPublic);
router.get("/manifest.webmanifest", controller.getManifest);
router.get("/assets/:slot", controller.getAsset);

// Any signed-in user (staff and Locators both use the address autocomplete).
// Not m_auth's isAuthenticated: inside a mounted router req.path lacks the
// "/api/" prefix it checks for (same as r_profile.js).
router.get("/runtime", (req, res, next) => {
  if (req.user) return next();
  return res.status(401).json({ success: false, message: "Authentication required" });
}, controller.getRuntime);

// Everything below: administrators only, always. Deliberately not a Control
// Panel menu permission — this page can change who gets locked out, where
// system email goes and whether anyone but admins can sign in, so it can't
// be granted to another role by mistake.
router.use(requireRole("admin"));

const limiter = (limit, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

// Saves that carry a password re-check share the sign-in lockout
// (lib/reauth.js); this per-IP cap only counts failed requests, like r_profile.js.
const saveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});
const uploadLimiter = limiter(40, "Too many uploads. Please try again later.");
const testEmailLimiter = limiter(5, "Too many test emails. Please wait a few minutes and try again.");

router.get("/", controller.getAll);
router.put("/:section", saveLimiter, controller.updateSection);
router.post("/assets/:slot", uploadLimiter, handleBrandingUpload, controller.uploadAsset);
router.delete("/assets/:slot", uploadLimiter, controller.removeAsset);
router.post("/email/test", testEmailLimiter, controller.sendTestEmail);

module.exports = router;
