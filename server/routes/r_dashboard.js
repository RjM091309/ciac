const express = require("express");
const router = express.Router();
const controller = require("../controller/c_dashboard");
const { authenticateToken, requireRole } = require("../middleware/m_auth");

// Scoped to the caller's own data (their proponent record, or their assigned
// applications) — no menu-level gate needed since it never exposes another
// user's rows.
router.get("/me", authenticateToken, controller.getMyDashboard);

// Admin-only preview of what the Officer/Proponent dashboard layouts look
// like with live sample data.
router.get("/preview/:role", requireRole("admin"), controller.getPreview);

// Admin-only preview of the Locator portal's non-Dashboard pages (My
// Applications, Contracts & Permits, My Business Profile, Activity History).
// Two path segments after /preview/, so it doesn't collide with /preview/:role.
router.get("/preview/proponent/detail", requireRole("admin"), controller.getProponentPreviewDetail);

module.exports = router;
