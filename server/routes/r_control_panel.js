const express = require("express");
const controlPanelController = require("../controller/c_control_panel");
const { authenticateToken, requireRole } = require("../middleware/m_auth");

const router = express.Router();

router.get("/sidebar-menu/:roleId", requireRole("admin"), controlPanelController.getSidebarPermissions);
router.put("/sidebar-menu/:roleId", requireRole("admin"), controlPanelController.setSidebarPermissions);
router.get("/menu-crud/:roleId", requireRole("admin"), controlPanelController.getMenuCrudPermissions);
router.put("/menu-crud/:roleId", requireRole("admin"), controlPanelController.setMenuCrudPermissions);
router.get("/dashboard-widgets/:roleId", requireRole("admin"), controlPanelController.getDashboardWidgetPermissions);
router.put("/dashboard-widgets/:roleId", requireRole("admin"), controlPanelController.setDashboardWidgetPermissions);

router.get("/me/sidebar-menu", authenticateToken, controlPanelController.getMySidebarPermissions);
router.get("/me/menu-crud", authenticateToken, controlPanelController.getMyMenuCrudPermissions);
router.get("/me/dashboard-widgets", authenticateToken, controlPanelController.getMyDashboardWidgetPermissions);

module.exports = router;
