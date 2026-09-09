const express = require("express");
const router = express.Router();
const rolesController = require("../controller/c_roles");
const { requireMenuAccess, requireRole } = require("../middleware/m_auth");

// Only consumed by User Management (role-assignment dropdown) and the
// admin-only Control Panel (which bypasses via the 'admin' exemption below).
// Gate it on the same permission as Users so a role granted "view" access to
// Users can actually populate that dropdown.
router.get("/", requireMenuAccess("settings:users", "view"), rolesController.list);

// Role definitions themselves are security-sensitive (they're what every
// other permission check keys off of) — admin-only to create/edit/retire.
router.post("/", requireRole("admin"), rolesController.create);
router.put("/:id", requireRole("admin"), rolesController.update);
router.patch("/:id/deactivate", requireRole("admin"), rolesController.deactivate);
router.patch("/:id/reactivate", requireRole("admin"), rolesController.reactivate);

module.exports = router;
