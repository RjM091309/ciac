// Sets the BDO and ACCOUNT OFFICER roles' Control Panel menus and
// Add/Edit/Delete rights to the standard setup (same as the dev server).
// The Level 1 / Level 2 picker in User Management only appears for a role
// with Evaluation Queue (BDO) or Approved Queue (Account Officer) on.
//
// Run migrate-assessment-officer-to-bdo.js first if the database still has
// an ASSESSMENT OFFICER role.
//
// Usage (from the server folder):
//   node scripts/set-default-role-access.js           dry run: shows the changes
//   node scripts/set-default-role-access.js --apply   writes them
// Replaces those two roles' menu/CRUD settings; other roles are untouched.
// Admins can still change anything afterwards in Control Panel.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");

const APPLY = process.argv.includes("--apply");
const ALL = { add: true, edit: true, delete: true };

const DEFAULTS = {
  // New applications: Locator Accounts → Evaluation Queue (Level 2 evaluates,
  // Level 1 assigns and approves) + the File Maintenance it uses.
  BDO: {
    dashboard: null,
    "settings:locator-users": ALL,
    "applications:new": null,
    "assessment:queue": ALL,
    "reports:analytics": null,
    "applications:requirements": ALL,
    "settings:application-types": ALL,
    "settings:building": ALL,
    "settings:land-use": ALL,
  },
  // Approved Queue, Registered Locators, renewals and permits.
  "ACCOUNT OFFICER": {
    dashboard: null,
    "approval:queue": ALL,
    "settings:proponents": { add: true, edit: true, delete: false },
    "compliance:permits": null,
    "applications:renewals": ALL,
    "compliance:inspections": { add: false, edit: true, delete: false },
    "reports:analytics": null,
    "settings:type-of-contract": ALL,
  },
};

(async () => {
  console.log(APPLY ? "Applying..." : "Dry run (nothing written) — add --apply to save.");
  for (const [roleName, menus] of Object.entries(DEFAULTS)) {
    const roleId = await Role.getActiveRoleIdByName(roleName);
    if (!roleId) {
      console.log(`- ${roleName}: role not found, skipped`);
      continue;
    }
    const sidebar = Object.keys(menus).map((menu_key) => ({ menu_key, is_enabled: true }));
    const crud = Object.entries(menus)
      .filter(([, c]) => c)
      .map(([menu_key, c]) => ({ menu_key, can_add: c.add, can_edit: c.edit, can_delete: c.delete }));
    console.log(`- ${roleName} (id ${roleId})`);
    console.log(`    menus: ${sidebar.map((r) => r.menu_key).join(", ")}`);
    console.log(
      `    add/edit/delete: ${crud
        .map((r) => `${r.menu_key} [${["add", "edit", "delete"].filter((a) => r[`can_${a}`]).join("/")}]`)
        .join(", ")}`
    );
    if (APPLY) {
      await ControlPanelPermission.setSidebarPermissions(roleId, sidebar);
      await ControlPanelPermission.setMenuCrudPermissions(roleId, crud);
    }
  }
  if (APPLY) console.log("Done. Restart the backend; users of these roles should sign in again.");
  process.exit(0);
})().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
