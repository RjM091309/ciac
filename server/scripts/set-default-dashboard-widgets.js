// Sets the recommended dashboard widgets for the BDO and ACCOUNT OFFICER
// roles (Control Panel → Dashboard Widgets). Admins can switch any of them
// on/off afterwards in Control Panel; this only gives a sensible start.
//
// Usage (from the server folder):  node scripts/set-default-dashboard-widgets.js
// Replaces those two roles' saved widget settings; other roles are untouched.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");

const ON = true;
const OFF = false;

const DEFAULTS = {
  // New applications: evaluation (Level 2) and assigning/approving (Level 1).
  BDO: {
    "dashboard:stats": ON,
    "dashboard:stats:total": ON,
    "dashboard:stats:pending": ON,
    "dashboard:stats:approved": ON,
    "dashboard:stats:disapproved": ON,
    "dashboard:stats:returned": ON, // Return to Evaluator happens on new applications
    "dashboard:stats:rejected": OFF, // not part of the current workflow
    "dashboard:stats:requirements": ON,
    "dashboard:stats:locators": OFF, // Account Officer only
    "dashboard:attention": ON,
    "dashboard:table": ON,
    "dashboard:status-chart": ON,
    "dashboard:pipeline": ON, // new filings over time
    "dashboard:performance": ON,
    "dashboard:requirements": ON,
    "dashboard:quick-tasks": ON,
  },
  // Renewals, the Approved Queue and Registered Locators.
  "ACCOUNT OFFICER": {
    "dashboard:stats": ON,
    "dashboard:stats:total": ON,
    "dashboard:stats:pending": ON,
    "dashboard:stats:approved": ON,
    "dashboard:stats:disapproved": ON,
    "dashboard:stats:returned": OFF, // rare on renewals
    "dashboard:stats:rejected": OFF, // not part of the current workflow
    "dashboard:stats:requirements": OFF, // replaced by Locators
    "dashboard:stats:locators": ON, // Registered Locators (Level 2: their own)
    "dashboard:attention": ON,
    "dashboard:table": ON,
    "dashboard:status-chart": ON,
    "dashboard:pipeline": OFF, // few renewals — the trend says little
    "dashboard:performance": ON,
    "dashboard:requirements": ON,
    "dashboard:quick-tasks": ON,
  },
};

(async () => {
  for (const [roleName, widgets] of Object.entries(DEFAULTS)) {
    const roleId = await Role.getActiveRoleIdByName(roleName);
    if (!roleId) {
      console.log(`- ${roleName}: role not found, skipped`);
      continue;
    }
    const rows = Object.entries(widgets).map(([widget_key, is_enabled]) => ({ widget_key, is_enabled }));
    await ControlPanelPermission.setDashboardWidgetPermissions(roleId, rows);
    const on = rows.filter((r) => r.is_enabled).length;
    console.log(`- ${roleName}: ${on} on, ${rows.length - on} off`);
  }
  process.exit(0);
})().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
