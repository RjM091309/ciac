const express = require("express");
const router = express.Router();
const usersController = require("../controller/c_users");
const { authenticateToken } = require("../middleware/m_auth");

router.get("/", authenticateToken, usersController.list);
router.get("/:id", authenticateToken, usersController.getById);
router.post("/", authenticateToken, usersController.create);
router.put("/:id", authenticateToken, usersController.update);
router.patch("/:id/deactivate", authenticateToken, usersController.deactivate);

module.exports = router;

