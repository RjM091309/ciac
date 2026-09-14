const express = require("express");
const router = express.Router();
const rolesController = require("../controller/c_roles");
const { requireAnyMenuAccess, requireRole } = require("../middleware/m_auth");

// Consumed by both User Management's and Locator Accounts' role-assignment
// dropdown, plus the admin-only Control Panel (which bypasses via the
// 'admin' exemption below) — either "view" permission is enough to populate
// the dropdown, matching /api/users' own GET / gate.
router.get("/", requireAnyMenuAccess(["settings:users", "settings:locator-users"], "view"), rolesController.list);

// Role definitions themselves are security-sensitive (they're what every
// other permission check keys off of) — admin-only to create/edit/retire.
router.post("/", requireRole("admin"), rolesController.create);
router.put("/:id", requireRole("admin"), rolesController.update);
router.patch("/:id/deactivate", requireRole("admin"), rolesController.deactivate);
router.patch("/:id/reactivate", requireRole("admin"), rolesController.reactivate);

module.exports = router;
