const express = require("express");
const router = express.Router();
const proponentsController = require("../controller/c_proponents");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "settings:proponents";

router.get("/", requireMenuAccess(MENU_KEY, "view"), proponentsController.list);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), proponentsController.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), proponentsController.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), proponentsController.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), proponentsController.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), proponentsController.reactivate);

module.exports = router;
