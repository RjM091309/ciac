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
router.patch("/:id/suspend", requireMenuAccess(MENU_KEY, "delete"), usersController.suspend);
router.patch("/:id/unsuspend", requireMenuAccess(MENU_KEY, "edit"), usersController.unsuspend);
router.post("/:id/revoke-sessions", requireMenuAccess(MENU_KEY, "edit"), usersController.revokeSessions);

// Two-factor: users self-enroll on login; admins can only reset a lost authenticator.
router.post("/:id/totp/reset", requireMenuAccess(MENU_KEY, "edit"), usersController.resetTotp);

module.exports = router;
