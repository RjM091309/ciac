const express = require("express");
const router = express.Router();
const controller = require("../controller/c_departments");
const { requireAnyMenuAccess } = require("../middleware/m_auth");

// Departments are managed from the Account Officers page (modal) and from
// User Management ("Manage Departments"), so either menu's permission works
// instead of a sidebar entry of their own.
const MENU_KEYS = ["settings:account-officers", "settings:users"];

router.get("/", requireAnyMenuAccess(MENU_KEYS, "view"), controller.list);
router.post("/", requireAnyMenuAccess(MENU_KEYS, "add"), controller.create);
router.put("/:id", requireAnyMenuAccess(MENU_KEYS, "edit"), controller.update);
router.patch("/:id/deactivate", requireAnyMenuAccess(MENU_KEYS, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireAnyMenuAccess(MENU_KEYS, "edit"), controller.reactivate);

module.exports = router;
