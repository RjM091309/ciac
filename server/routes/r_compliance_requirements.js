const express = require("express");
const router = express.Router();
const controller = require("../controller/c_compliance_requirements");
const { requireMenuAccess } = require("../middleware/m_auth");

// Managed from the Compliance Requirements tab of Compliance & Inspection.
const MENU_KEY = "compliance:inspections";

router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), controller.reactivate);

module.exports = router;
