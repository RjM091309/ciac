const express = require("express");
const controlPanelController = require("../controller/c_control_panel");
const { authenticateToken, requireRole } = require("../middleware/m_auth");

const router = express.Router();

router.get("/sidebar-menu/:roleId", requireRole("admin"), controlPanelController.getSidebarPermissions);
router.put("/sidebar-menu/:roleId", requireRole("admin"), controlPanelController.setSidebarPermissions);
router.get("/menu-crud/:roleId", requireRole("admin"), controlPanelController.getMenuCrudPermissions);
router.put("/menu-crud/:roleId", requireRole("admin"), controlPanelController.setMenuCrudPermissions);

router.get("/me/sidebar-menu", authenticateToken, controlPanelController.getMySidebarPermissions);
router.get("/me/menu-crud", authenticateToken, controlPanelController.getMyMenuCrudPermissions);

module.exports = router;
