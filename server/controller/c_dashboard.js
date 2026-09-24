const Workflow = require("../models/ApplicationWorkflow");
const Proponent = require("../models/Proponent");
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");
const Assessment = require("../models/AssessmentEvaluation");
const Contract = require("../models/Contract");
const Permit = require("../models/Permit");
const ActivityLog = require("../models/ActivityLog");

/** The admin previewing "what Officer/Proponent sees" is still an admin —
 * fullAccess in ControlPanelAccessContext would otherwise ignore whatever
 * widget visibility was configured for the previewed role. Fetching it here
 * and shipping it with the preview payload is what makes the preview honest. */
async function getWidgetVisibilityForRoleName(roleName) {
  const roleId = await Role.getActiveRoleIdByName(roleName);
  if (!roleId) return [];
  return await ControlPanelPermission.getDashboardWidgetPermissions(roleId);
}

/** Lets the admin's dashboard-preview switcher also swap the sidebar to
 * what that role actually sees (Control Panel's sidebar menu permissions),
 * instead of leaving the admin's own full sidebar showing underneath. */
async function getSidebarVisibilityForRoleName(roleName) {
  const roleId = await Role.getActiveRoleIdByName(roleName);
  if (!roleId) return [];
  return await ControlPanelPermission.getSidebarPermissions(roleId);
}

function upper(v) {
  return String(v || "").toUpperCase();
}

// Shared status breakdown used by every dashboard view (admin/officer/
// proponent) so "pending / approved / rejected / returned" means the same
// thing everywhere (DBM-03) — the officer/proponent views used to only
// distinguish total/pending/approved, with no separate "returned" count.
function summarize(applications) {
  const total = applications.length;
  const draft = applications.filter((a) => upper(a.status) === "DRAFT").length;
  const approved = applications.filter((a) => upper(a.status) === "APPROVED").length;
  const rejected = applications.filter((a) => upper(a.status) === "REJECTED").length;
  const returned = applications.filter((a) => upper(a.status) === "RETURNED").length;
  const pending = total - draft - approved - rejected - returned;
  const requirementsTotal = applications.reduce((sum, a) => sum + Number(a.requirements_total || 0), 0);
  const requirementsVerified = applications.reduce((sum, a) => sum + Number(a.requirements_verified || 0), 0);
  return { total, draft, pending, approved, rejected, returned, requirementsTotal, requirementsVerified };
}

function periodKey(date, unit) {
  if (unit === "day") {
    return date.toISOString().slice(0, 10);
  }
  if (unit === "week") {
    // ISO-ish week bucket: Monday-start week, keyed by that Monday's date.
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }
  if (unit === "quarter") {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `${date.getFullYear()}-Q${q}`;
  }
  if (unit === "year") {
    return String(date.getFullYear());
  }
  // month
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(date, unit) {
  if (unit === "day") return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (unit === "week") return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (unit === "quarter") return `Q${Math.floor(date.getMonth() / 3) + 1} '${String(date.getFullYear()).slice(2)}`;
  if (unit === "year") return String(date.getFullYear());
  return date.toLocaleDateString("en-US", { month: "short" });
}

/** Builds `count` trailing buckets ending at "now", each a real count of
 * applications created in that period — this is what backs DBM-04 (daily /
 * weekly / monthly / quarterly / yearly reporting). */
function bucketByPeriod(applications, unit, count) {
  const now = new Date();
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    let d;
    if (unit === "day") d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    else if (unit === "week") d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
    else if (unit === "quarter") d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
    else if (unit === "year") d = new Date(now.getFullYear() - i, 0, 1);
    else d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: periodKey(d, unit), label: periodLabel(d, unit), total: 0, approved: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const a of applications) {
    const created = a.created_at ? new Date(a.created_at) : null;
    if (!created || Number.isNaN(created.getTime())) continue;
    const bucket = byKey.get(periodKey(created, unit));
    if (!bucket) continue;
    bucket.total += 1;
    if (upper(a.status) === "APPROVED") bucket.approved += 1;
  }
  return buckets.map(({ key, ...rest }) => rest);
}

// System-wide overview for the admin dashboard: real counts instead of mock data.
function summarizeAdmin(applications, proponents) {
  const totalApplications = applications.length;
  const newApplications = applications.filter((a) => !Number(a.is_renewal)).length;
  const renewalApplications = applications.filter((a) => Number(a.is_renewal)).length;

  const statusBreakdown = summarize(applications);

  const now = new Date();
  const todayKey = now.toDateString();
  const applicationsToday = applications.filter((a) => {
    const created = a.created_at ? new Date(a.created_at) : null;
    return created && !Number.isNaN(created.getTime()) && created.toDateString() === todayKey;
  }).length;

  return {
    totals: {
      registeredBusinesses: proponents.filter((p) => Number(p.is_active)).length,
      totalBusinesses: proponents.length,
      totalApplications,
      newApplications,
      renewalApplications,
      applicationsToday,
    },
    statusBreakdown,
    requirements: { total: statusBreakdown.requirementsTotal, verified: statusBreakdown.requirementsVerified },
    trends: {
      daily: bucketByPeriod(applications, "day", 14).map((b, i, arr) => ({ ...b, label: i === arr.length - 1 ? "Today" : b.label })),
      weekly: bucketByPeriod(applications, "week", 8),
      monthly: bucketByPeriod(applications, "month", 6),
      quarterly: bucketByPeriod(applications, "quarter", 4),
      yearly: bucketByPeriod(applications, "year", 3),
    },
    // Kept for older callers of this endpoint's monthly-only shape.
    monthlyTrend: bucketByPeriod(applications, "month", 6),
  };
}

/** Real "needs attention" list — replaces the old hardcoded Quick Tasks
 * sample data (DBM-06). Oldest-first so the longest-waiting items surface.
 * `statuses`/`isRenewal` let a caller scope this to one queue's shape (e.g.
 * only FOR_APPROVAL renewals for the Account Officer) instead of the default
 * pre-assessment mix. */
function attentionQueue(
  applications,
  { limit = 6, statuses = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"], isRenewal } = {}
) {
  const now = Date.now();
  return applications
    .filter((a) => statuses.includes(upper(a.status)))
    .filter((a) => isRenewal === undefined || Boolean(Number(a.is_renewal)) === isRenewal)
    .map((a) => ({
      application_id: a.id,
      application_no: a.application_no,
      proponent_name: a.proponent_name,
      status: a.status,
      is_renewal: Boolean(Number(a.is_renewal)),
      days_waiting: a.created_at ? Math.max(0, Math.round((now - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24))) : 0,
    }))
    .sort((a, b) => b.days_waiting - a.days_waiting)
    .slice(0, limit);
}

const EXPIRY_ATTENTION_WINDOW_DAYS = 30;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Permits/contracts already expired or expiring within the window, for the
 * Account Officer's "Needs Your Attention" widget — renewal isn't just about
 * new applications waiting in the queue, it's also about what's about to
 * lapse. Expired-first, then soonest-to-expire. */
async function buildExpiryAttentionItems(limit) {
  const [permits, contracts] = await Promise.all([Permit.listAll(), Contract.listAll()]);

  const permitItems = permits
    .filter((p) => p.effective_status === "EXPIRING" || p.effective_status === "EXPIRED")
    .map((p) => {
      const days = daysUntil(p.expiry_date);
      return {
        kind: "permit",
        application_id: p.application_id || p.id,
        application_no: `Permit ${p.permit_no}`,
        proponent_name: p.proponent_name,
        status: p.effective_status,
        is_expired: p.effective_status === "EXPIRED",
        days_waiting: days === null ? 0 : Math.abs(days),
      };
    });

  const contractItems = contracts
    .map((c) => ({ ...c, _days: daysUntil(c.effective_end) }))
    .filter((c) => c._days !== null && c._days <= EXPIRY_ATTENTION_WINDOW_DAYS)
    .map((c) => ({
      kind: "contract",
      application_id: c.application_id,
      application_no: `Contract ${c.contract_no}`,
      proponent_name: c.proponent_name,
      status: c._days < 0 ? "EXPIRED" : "EXPIRING",
      is_expired: c._days < 0,
      days_waiting: Math.abs(c._days),
    }));

  return [...permitItems, ...contractItems]
    .sort((a, b) => (a.is_expired === b.is_expired ? a.days_waiting - b.days_waiting : a.is_expired ? -1 : 1))
    .slice(0, limit);
}

/** Whether `sidebarPermissions` (a role's Control Panel sidebar rows) grants
 * a given menu — same enabled-flag check used throughout this codebase for
 * permission-driven (not hardcoded-role-name) decisions. */
function hasMenu(sidebarPermissions, menuKey) {
  return sidebarPermissions.some(
    (p) => p.menu_key === menuKey && (Number(p.is_enabled) === 1 || p.is_enabled === true)
  );
}

/** Scopes a whole applications list (table + stats, not just the attention
 * widget) to what each queue role actually works with — renewals only for
 * the Account Officer's Approval Queue, new applications only for the
 * Assessment Officer's Assessment Queue. Without this, the admin's preview
 * switcher showed the exact same system-wide list/stats no matter which
 * role was selected, since only the attention widget was being scoped. Any
 * other role (no queue-specific menu) keeps seeing everything, unscoped. */
function scopeApplicationsForRole(applications, sidebarPermissions, assignedIds = null) {
  if (hasMenu(sidebarPermissions, "approval:queue")) {
    return applications.filter((a) => Boolean(Number(a.is_renewal)));
  }
  if (hasMenu(sidebarPermissions, "assessment:queue")) {
    // A Level 2 Assessment Officer's dashboard is just their own
    // assignments (assignedIds; null in the admin's identity-less preview).
    if (assignedIds) return applications.filter((a) => assignedIds.has(Number(a.id)));
    return applications.filter((a) => !Boolean(Number(a.is_renewal)));
  }
  return applications;
}

/** Scopes the "Needs Your Attention" widget to the shape each queue role
 * actually cares about: the Account Officer's Approval Queue only ever acts
 * on renewals waiting for approval; the Assessment Officer's Assessment
 * Queue only ever acts on new applications still pre-assessment. Driven by
 * Control Panel menu access (approval:queue / assessment:queue), not a
 * hardcoded role name, so this keeps working if either role is renamed and
 * applies the same way to the admin's dashboard-preview switcher. Falls back
 * to the caller's own default attention list for any other role shape. */
async function buildRoleAttention(sidebarPermissions, fallbackApplications, assignedIds = null) {
  if (hasMenu(sidebarPermissions, "approval:queue")) {
    const [all, expiryItems] = await Promise.all([
      Workflow.listAllApplicationsWithProgress(),
      buildExpiryAttentionItems(6),
    ]);
    const remaining = Math.max(0, 6 - expiryItems.length);
    const appItems = attentionQueue(all, { statuses: ["FOR_APPROVAL"], isRenewal: true, limit: remaining });
    return [...expiryItems, ...appItems];
  }
  if (hasMenu(sidebarPermissions, "assessment:queue")) {
    if (assignedIds) {
      // Level 2: everything assigned to them that's still in motion.
      return attentionQueue(fallbackApplications, { statuses: ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "RETURNED"] });
    }
    const all = await Workflow.listAllApplicationsWithProgress();
    return attentionQueue(all, { statuses: ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"], isRenewal: false });
  }
  return attentionQueue(fallbackApplications);
}

exports.getMyDashboard = async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();

    if (role === "proponent") {
      const proponent = await Proponent.getProponentByUserId(req.user.id);
      if (!proponent) {
        return res.json({
          success: true,
          role: "proponent",
          data: { proponent: null, applications: [], stats: summarize([]) },
        });
      }
      const applications = await Workflow.listApplicationsForProponent(proponent.id);
      return res.json({
        success: true,
        role: "proponent",
        data: { proponent, applications, stats: summarize(applications) },
      });
    }

    if (role === "admin") {
      // Only the literal admin role gets the real system-wide overview —
      // this used to be the fallback for "officer or anything else", which
      // meant a custom staff role (Account Officer, Assessment Officer, or
      // any future one) that isn't literally named "officer" fell through
      // to here and got the *admin-level* dashboard (every application,
      // every proponent) instead of its own scoped view. Not just an
      // "OFFICER can't be renamed" problem — a real data-exposure bug for
      // any custom role the moment a user was assigned to it.
      const [applications, proponents, categoryCompletion, turnaround] = await Promise.all([
        Workflow.listAllApplicationsWithProgress(),
        Proponent.listProponents(),
        Workflow.getRequirementCompletionByCategory(),
        Workflow.getApplicationTurnaroundStats(),
      ]);
      return res.json({
        success: true,
        role,
        data: {
          ...summarizeAdmin(applications, proponents),
          categoryCompletion,
          turnaround,
          attention: attentionQueue(applications),
        },
      });
    }

    // Every other role — Officer, Account Officer, Assessment Officer, or
    // any future custom staff role — shares the same scoped "my assigned
    // applications" dashboard, scoped by Control Panel queue access
    // (approval:queue -> renewals, assessment:queue -> new applications)
    // via scopeApplicationsForRole, same as the admin's preview switcher.
    // Not listApplicationsForOfficer's current_officer_id assignment — that
    // column is never actually set anywhere in this codebase, so it always
    // returned an empty "Assigned to Me" for every real staff account.
    const roleId = await Role.getActiveRoleIdByName(role);
    const sidebarPermissions = roleId ? await ControlPanelPermission.getSidebarPermissions(roleId) : [];
    const allApplications = await Workflow.listAllApplicationsWithProgress();
    const assignedIds = (await Assessment.isScopedLevel2(req.user.id, sidebarPermissions))
      ? await Assessment.listApplicationIdsAssignedTo(req.user.id)
      : null;
    const applications = scopeApplicationsForRole(allApplications, sidebarPermissions, assignedIds);
    const attention = await buildRoleAttention(sidebarPermissions, applications, assignedIds);
    return res.json({
      success: true,
      role: "officer",
      data: { applications, stats: summarize(applications), attention },
    });
  } catch (error) {
    console.error("Get my dashboard error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Admin-only "preview what this role's dashboard looks like" — not scoped to
// a real officer/proponent identity, just a representative sample of live
// system data shaped the same way the real per-role dashboard is.
exports.getPreview = async (req, res) => {
  try {
    // Express decodes the route param already (e.g. "Account%20Officer" ->
    // "Account Officer"), so this is the role's exact name as stored, not a
    // slug — only lower-cased here for the 'proponent' sentinel comparison.
    const rawPreviewRole = String(req.params.role || "").trim();
    const previewRole = rawPreviewRole.toLowerCase();

    if (previewRole === "proponent") {
      const [widgetPermissions, sidebarPermissions] = await Promise.all([
        getWidgetVisibilityForRoleName("proponent"),
        getSidebarVisibilityForRoleName("proponent"),
      ]);
      // The admin's own linked business profile, not a random real locator's
      // — the preview shows the admin's own data (the admin account holds
      // the Locator role too, same as it already holds Officer), never
      // another user's private records under an unlabeled "preview".
      const proponent = await Proponent.getProponentByUserId(req.user.id);
      if (!proponent) {
        return res.json({
          success: true,
          role: "proponent",
          widgetPermissions,
          sidebarPermissions,
          data: { proponent: null, applications: [], stats: summarize([]) },
        });
      }
      const applications = await Workflow.listApplicationsForProponent(proponent.id);
      return res.json({
        success: true,
        role: "proponent",
        widgetPermissions,
        sidebarPermissions,
        data: { proponent, applications, stats: summarize(applications) },
      });
    }

    // Any other value is a role ID — Officer, Account Officer, Assessment
    // Officer, or any future custom staff role, all sharing the same
    // officer-style application-management dashboard; only widget/sidebar
    // visibility differs, driven by that exact role's own Control Panel
    // permissions. ID rather than name: these roles (unlike the 3 fixed
    // system ones) CAN be renamed, so a name in the URL could go stale
    // mid-session, and an ID skips the extra name -> id lookup entirely
    // since Control Panel permissions are already keyed by role_id.
    const roleId = Number(rawPreviewRole);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return res.status(400).json({ success: false, message: "Unknown preview role" });
    }
    const role = await Role.getRoleById(roleId);
    if (!role || !role.is_active) {
      return res.status(400).json({ success: false, message: "Unknown preview role" });
    }
    const [allApplications, widgetPermissions, sidebarPermissions] = await Promise.all([
      Workflow.listAllApplicationsWithProgress(),
      ControlPanelPermission.getDashboardWidgetPermissions(roleId),
      ControlPanelPermission.getSidebarPermissions(roleId),
    ]);
    // Scope the whole preview (table + stats), not just the attention
    // widget — otherwise every role preview showed the identical
    // system-wide list regardless of which one was selected.
    const applications = scopeApplicationsForRole(allApplications, sidebarPermissions);
    // buildRoleAttention does its own system-wide fetch for the queue-scoped
    // branches (needed since `applications` here is already renewal/new-only
    // — the attention widget for approval:queue also needs expiring
    // permits/contracts, which aren't application rows at all); the
    // already-scoped `applications` is only used as the plain fallback.
    const attention = await buildRoleAttention(sidebarPermissions, applications);
    return res.json({
      success: true,
      role: "officer",
      widgetPermissions,
      sidebarPermissions,
      data: { applications, stats: summarize(applications), attention },
    });
  } catch (error) {
    console.error("Get dashboard preview error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Admin-only "preview what the Locator portal's non-Dashboard pages look
// like" — the admin's own linked business profile (see getPreview above),
// covering the four ProponentSidebar sections the Dashboard preview alone
// doesn't reach: applications, business profile, contracts & permits, and
// activity history.
exports.getProponentPreviewDetail = async (req, res) => {
  try {
    const proponent = await Proponent.getProponentByUserId(req.user.id);
    if (!proponent) {
      return res.json({
        success: true,
        data: { proponent: null, applications: [], contracts: [], permits: [], activity: [] },
      });
    }

    const proponentId = proponent.id;
    const [applications, contracts, permits, activity] = await Promise.all([
      Workflow.listApplicationsForProponent(proponentId),
      Contract.listByProponentId(proponentId),
      Permit.listByProponent(proponentId),
      ActivityLog.listForProponent(proponentId, proponent.user_id ?? null, { limit: 30 }),
    ]);

    return res.json({
      success: true,
      data: { proponent, applications, contracts, permits, activity },
    });
  } catch (error) {
    console.error("Get proponent preview detail error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
