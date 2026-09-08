const express = require("express");
const router = express.Router();
const controller = require("../controller/c_compliance_types");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "settings:compliance-types";

router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), controller.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), controller.reactivate);

module.exports = router;
