const express = require("express");
const router = express.Router();
const controller = require("../controller/c_type_of_contract");
const { requireMenuAccess, isAuthenticated } = require("../middleware/m_auth");

const MENU_KEY = "settings:type-of-contract";

// Read-only lookup for the Requirements page and New/Renewal Application
// form (same as GET /api/application-types); writes stay permission-gated.
router.get("/", isAuthenticated, controller.list);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), controller.reactivate);

module.exports = router;
