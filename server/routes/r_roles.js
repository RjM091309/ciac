const express = require("express");
const router = express.Router();
const rolesController = require("../controller/c_roles");
const { requireMenuAccess } = require("../middleware/m_auth");

// Only consumed by User Management (role-assignment dropdown) and the
// admin-only Control Panel (which bypasses via the 'admin' exemption below).
// Gate it on the same permission as Users so a role granted "view" access to
// Users can actually populate that dropdown.
router.get("/", requireMenuAccess("settings:users", "view"), rolesController.list);

module.exports = router;
