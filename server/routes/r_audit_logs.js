const express = require("express");
const router = express.Router();
const controller = require("../controller/c_audit_logs");
const { requireRole } = require("../middleware/m_auth");

// Compliance-facing — admin only, no partial-access tier.
router.get("/", requireRole("admin"), controller.list);
router.get("/actions", requireRole("admin"), controller.listActions);

module.exports = router;
