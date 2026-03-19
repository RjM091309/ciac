const express = require("express");
const router = express.Router();
const usersController = require("../controller/c_users");
const { requireRole } = require("../middleware/m_auth");

router.get("/", requireRole("admin"), usersController.list);
router.get("/:id", requireRole("admin"), usersController.getById);
router.post("/", requireRole("admin"), usersController.create);
router.put("/:id", requireRole("admin"), usersController.update);
router.patch("/:id/deactivate", requireRole("admin"), usersController.deactivate);

module.exports = router;

