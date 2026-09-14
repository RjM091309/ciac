const express = require("express");
const router = express.Router();
const usersController = require("../controller/c_users");
const { requireMenuAccess, isAuthenticated } = require("../middleware/m_auth");

const MENU_KEY = "settings:users";

// Self-service — any signed-in user changing their own password, regardless
// of role or Control Panel permissions (not gated by MENU_KEY, which only
// covers admin management of *other* users' accounts).
router.patch("/me/password", isAuthenticated, usersController.changeMyPassword);

router.get("/", requireMenuAccess(MENU_KEY, "view"), usersController.list);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), usersController.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), usersController.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), usersController.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), usersController.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), usersController.reactivate);
router.patch("/:id/suspend", requireMenuAccess(MENU_KEY, "delete"), usersController.suspend);
router.patch("/:id/unsuspend", requireMenuAccess(MENU_KEY, "edit"), usersController.unsuspend);
router.post("/:id/revoke-sessions", requireMenuAccess(MENU_KEY, "edit"), usersController.revokeSessions);
router.post("/:id/reset-password", requireMenuAccess(MENU_KEY, "edit"), usersController.resetPassword);

// Self-service registration review
router.patch("/:id/approve", requireMenuAccess(MENU_KEY, "edit"), usersController.approve);
router.patch("/:id/reject", requireMenuAccess(MENU_KEY, "edit"), usersController.reject);

// Two-factor: users self-enroll on login; admins can only reset a lost authenticator.
router.post("/:id/totp/reset", requireMenuAccess(MENU_KEY, "edit"), usersController.resetTotp);

module.exports = router;
