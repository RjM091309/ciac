const express = require("express");
const router = express.Router();
const controller = require("../controller/c_search");
const { isAuthenticated } = require("../middleware/m_auth");

// Any authenticated staff role — bucket-level filtering (which queues a
// result can come from) happens inside the controller by Control Panel
// permission, same as every other cross-module screen in this app.
router.get("/", isAuthenticated, controller.search);

module.exports = router;
