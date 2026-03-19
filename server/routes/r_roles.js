const express = require("express");
const router = express.Router();
const rolesController = require("../controller/c_roles");
const { requireRole } = require("../middleware/m_auth");

router.get("/", requireRole("admin"), rolesController.list);

module.exports = router;

