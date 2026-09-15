const express = require("express");
const router = express.Router();
const controller = require("../controller/c_application_types");
const { requireMenuAccess, isAuthenticated } = require("../middleware/m_auth");

const MENU_KEY = "settings:application-types";

// Plain reference-data lookup (the New/Renewal Application "Application
// Type" dropdown, for both staff and a locator filing their own) — not
// gated behind the File Maintenance CRUD menu, same reasoning as
// r_proponents.js's GET /: whoever's filing needs to read the list even
// though only File Maintenance can manage it.
router.get("/", isAuthenticated, controller.list);
router.get("/:id", isAuthenticated, controller.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), controller.reactivate);

module.exports = router;
