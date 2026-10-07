// The staff (non-admin, non-Locator) dashboard's widgets an admin can toggle
// per role in Control Panel — the single source of truth for which widgets
// exist, which roles may have each one, and whether a role sees it. Shared by
// the dashboard API (only eligible + enabled widgets get data), the Control
// Panel (only eligible widgets get a toggle) and the admin preview.
//
// Eligibility is driven by a role's Sidebar menu access, never its name, so it
// survives renames and covers custom roles:
//   - aggregate widgets (counts, charts) — any staff role;
//   - row-level widgets (application rows with locator names) — only roles
//     that can already open an applications page (same keys as
//     requireApplicationsAccess in middleware/m_auth.js);
//   - queue widgets — only roles that work a queue.

const APPLICATION_MENUS = ["applications:new", "applications:renewals", "assessment:queue", "approval:queue"];
// The queues that have a "Needs Attention" list (BDO evaluation; Account
// Officer Approved/Renewal Queue).
const QUEUE_MENUS = ["assessment:queue", "approval:queue", "applications:renewals"];
const REQUIREMENT_MENUS = [...APPLICATION_MENUS, "applications:requirements"];

const STATS_PARENT = "dashboard:stats";

/** `requiresAnyMenu` empty = any staff role. `parent` = nested under that
 * widget in Control Panel, and hidden whenever the parent is off. */
const WIDGETS = [
  { key: STATS_PARENT, label: "Stat Cards", group: "summary", requiresAnyMenu: [] },
  { key: "dashboard:stats:total", label: "Total", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:stats:pending", label: "Pending", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:stats:approved", label: "Approved", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:stats:disapproved", label: "Disapproved", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:stats:rejected", label: "Rejected", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:stats:returned", label: "Returned", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:stats:requirements", label: "Requirements Verified", parent: STATS_PARENT, requiresAnyMenu: [] },
  { key: "dashboard:attention", label: "Needs Attention", group: "work", requiresAnyMenu: QUEUE_MENUS },
  { key: "dashboard:table", label: "Applications Table", group: "work", requiresAnyMenu: APPLICATION_MENUS },
  { key: "dashboard:status-chart", label: "Status Breakdown", group: "insights", requiresAnyMenu: [] },
  { key: "dashboard:pipeline", label: "Application Pipeline", group: "insights", requiresAnyMenu: [] },
  { key: "dashboard:performance", label: "Processing Performance", group: "insights", requiresAnyMenu: [] },
  { key: "dashboard:requirements", label: "Requirements Overview", group: "insights", requiresAnyMenu: REQUIREMENT_MENUS },
  { key: "dashboard:quick-tasks", label: "Quick Tasks", group: "tools", requiresAnyMenu: [] },
];

const WIDGET_KEYS = new Set(WIDGETS.map((w) => w.key));
const BY_KEY = new Map(WIDGETS.map((w) => [w.key, w]));

function isEnabledRow(row) {
  return Number(row?.is_enabled) === 1 || row?.is_enabled === true;
}

/** Set of menu keys a role's saved sidebar rows turn on. */
function enabledMenus(sidebarRows) {
  return new Set((sidebarRows || []).filter(isEnabledRow).map((r) => String(r.menu_key)));
}

function isEligible(widget, menus) {
  if (!widget) return false;
  if (widget.parent && !isEligible(BY_KEY.get(widget.parent), menus)) return false;
  return widget.requiresAnyMenu.length === 0 || widget.requiresAnyMenu.some((m) => menus.has(m));
}

/**
 * Map of widget key -> visible, for a role. A widget is visible only when the
 * role is eligible for it AND it isn't turned off. Every widget defaults to on
 * (no saved row = visible): hiding a card is a display choice, and a new
 * widget shouldn't silently vanish for every role until an admin revisits
 * Control Panel. A child card is also hidden whenever its parent is off.
 * A role with no menu access at all sees no widgets.
 */
function resolveVisibility(sidebarRows, widgetRows) {
  const menus = enabledMenus(sidebarRows);
  // A role with no menu access at all (unknown/inactive, or a new role not
  // configured yet) gets nothing — fail closed, like every other permission.
  if (menus.size === 0) return Object.fromEntries(WIDGETS.map((w) => [w.key, false]));
  const saved = new Map((widgetRows || []).map((r) => [String(r.widget_key), isEnabledRow(r)]));
  const visible = {};
  for (const w of WIDGETS) {
    visible[w.key] = isEligible(w, menus) && (saved.get(w.key) ?? true);
  }
  for (const w of WIDGETS) {
    if (w.parent && !visible[w.parent]) visible[w.key] = false;
  }
  return visible;
}

/** Catalog as the Control Panel consumes it (plain data, so the client can
 * evaluate eligibility against the admin's unsaved Menus-tab edits). */
function catalog() {
  return WIDGETS.map(({ key, label, group, parent, requiresAnyMenu }) => ({
    key,
    label,
    group: group || null,
    parent: parent || null,
    requiresAnyMenu,
  }));
}

/** Keeps only known widget keys, so a save can't store junk rows. */
function sanitizeWidgetRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => WIDGET_KEYS.has(String(r?.widget_key)));
}

module.exports = {
  APPLICATION_MENUS,
  QUEUE_MENUS,
  enabledMenus,
  resolveVisibility,
  catalog,
  sanitizeWidgetRows,
};
