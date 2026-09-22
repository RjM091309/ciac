const express = require("express");
const router = express.Router();
const controller = require("../controller/c_departments");
const { requireMenuAccess } = require("../middleware/m_auth");

// Departments are managed from the Account Officers page (modal), so they share
// its menu permission instead of getting a sidebar entry of their own.
const MENU_KEY = "settings:account-officers";

router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), controller.reactivate);

module.exports = router;
