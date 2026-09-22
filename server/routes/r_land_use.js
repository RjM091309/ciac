const express = require("express");
const router = express.Router();
const controller = require("../controller/c_land_use");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "settings:land-use";

router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), controller.reactivate);

module.exports = router;
