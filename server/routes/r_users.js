const express = require("express");
const router = express.Router();
const usersController = require("../controller/c_users");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "settings:users";

router.get("/", requireMenuAccess(MENU_KEY, "view"), usersController.list);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), usersController.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), usersController.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), usersController.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), usersController.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), usersController.reactivate);

module.exports = router;
