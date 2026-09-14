const express = require("express");
const router = express.Router();
const usersController = require("../controller/c_users");
const { requireAnyMenuAccess, requireUserMenuAccess, isAuthenticated } = require("../middleware/m_auth");

// "User Management" and "Locator Accounts" are two separate Control Panel
// permissions over the same underlying /api/users data — a role can hold
// either, both, or neither independently. Routes that act on one specific
// account (or create one) check whichever permission actually matches that
// account's role (see requireUserMenuAccess); the plain list, which mixes
// both kinds of accounts in one response, just needs at least one of the two.
const USER_MENU_KEYS = ["settings:users", "settings:locator-users"];

// Self-service — any signed-in user changing their own password, regardless
// of role or Control Panel permissions (not gated by USER_MENU_KEYS, which
// only covers admin management of *other* users' accounts).
router.patch("/me/password", isAuthenticated, usersController.changeMyPassword);

router.get("/", requireAnyMenuAccess(USER_MENU_KEYS, "view"), usersController.list);
router.get("/:id", requireUserMenuAccess("view"), usersController.getById);
router.post("/", requireUserMenuAccess("add"), usersController.create);
router.put("/:id", requireUserMenuAccess("edit"), usersController.update);
router.patch("/:id/deactivate", requireUserMenuAccess("delete"), usersController.deactivate);
router.patch("/:id/reactivate", requireUserMenuAccess("edit"), usersController.reactivate);
router.patch("/:id/suspend", requireUserMenuAccess("delete"), usersController.suspend);
router.patch("/:id/unsuspend", requireUserMenuAccess("edit"), usersController.unsuspend);
router.post("/:id/revoke-sessions", requireUserMenuAccess("edit"), usersController.revokeSessions);
router.post("/:id/reset-password", requireUserMenuAccess("edit"), usersController.resetPassword);

// Self-service registration review
router.patch("/:id/approve", requireUserMenuAccess("edit"), usersController.approve);
router.patch("/:id/reject", requireUserMenuAccess("edit"), usersController.reject);

// Two-factor: users self-enroll on login; admins can only reset a lost authenticator.
router.post("/:id/totp/reset", requireUserMenuAccess("edit"), usersController.resetTotp);

module.exports = router;
