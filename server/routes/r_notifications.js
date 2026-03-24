const express = require("express");
const router = express.Router();
const controller = require("../controller/c_notifications");
const { authenticateToken } = require("../middleware/m_auth");

router.get("/me", authenticateToken, controller.listMine);
router.patch("/:id/read", authenticateToken, controller.markRead);
router.patch("/read-all", authenticateToken, controller.markAllRead);

module.exports = router;
