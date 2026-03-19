const express = require("express");
const router = express.Router();
const rolesController = require("../controller/c_roles");
const { authenticateToken } = require("../middleware/m_auth");

router.get("/", authenticateToken, rolesController.list);

module.exports = router;

