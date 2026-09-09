const express = require("express");
const router = express.Router();
const controller = require("../controller/c_quick_tasks");
const { authenticateToken } = require("../middleware/m_auth");

// Personal to-do list — scoped to the caller's own rows in the controller,
// so any authenticated user may use it (no menu-level gate needed).
router.get("/", authenticateToken, controller.list);
router.post("/", authenticateToken, controller.create);
router.patch("/:id", authenticateToken, controller.setDone);
router.delete("/:id", authenticateToken, controller.remove);

module.exports = router;
