const express = require("express");
const router = express.Router();
const controller = require("../controller/c_documents");
const { authenticateToken } = require("../middleware/m_auth");

router.get("/:id/download", authenticateToken, controller.download);

module.exports = router;
