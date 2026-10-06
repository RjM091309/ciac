const Workflow = require("../models/ApplicationWorkflow");
const Proponent = require("../models/Proponent");
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");
const Assessment = require("../models/AssessmentEvaluation");
const Approval = require("../models/ApprovalIssuance");
const Contract = require("../models/Contract");
const Permit = require("../models/Permit");
const ActivityLog = require("../models/ActivityLog");
const DashboardWidgets = require("../lib/dashboardWidgets");
const { publicErrorMessage } = require("../lib/httpError");

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
// thing everywhere (DBM-03). DISAPPROVED is a final decision (Assessment or
// Approval said no), so it's its own count — it used to fall into "pending"
// as a leftover.
function summarize(applications) {
  const total = applications.length;
  const draft = applications.filter((a) => upper(a.status) === "DRAFT").length;
  const approved = applications.filter((a) => upper(a.status) === "APPROVED").length;
  const disapproved = applications.filter((a) => upper(a.status) === "DISAPPROVED").length;
  const rejected = applications.filter((a) => upper(a.status) === "REJECTED").length;
  const returned = applications.filter((a) => upper(a.status) === "RETURNED").length;
  const pending = total - draft - approved - disapproved - rejected - returned;
  const requirementsTotal = applications.reduce((sum, a) => sum + Number(a.requirements_total || 0), 0);
  const requirementsVerified = applications.reduce((sum, a) => sum + Number(a.requirements_verified || 0), 0);
  return { total, draft, pending, approved, disapproved, rejected, returned, requirementsTotal, requirementsVerified };
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

/** Every reporting period the Application Pipeline chart can switch to. */
function buildTrends(applications) {
  return {
    daily: bucketByPeriod(applications, "day", 14).map((b, i, arr) => ({ ...b, label: i === arr.length - 1 ? "Today" : b.label })),
    weekly: bucketByPeriod(applications, "week", 8),
    monthly: bucketByPeriod(applications, "month", 6),
    quarterly: bucketByPeriod(applications, "quarter", 4),
    yearly: bucketByPeriod(applications, "year", 3),
  };
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
    trends: buildTrends(applications),
    // Kept for older callers of this endpoint's monthly-only shape.
    monthlyTrend: bucketByPeriod(applications, "month", 6),
  };
}

/** Real "needs attention" list — replaces the old hardcoded Quick Tasks
 * sample data (DBM-06). Oldest-first so the longest-waiting items surface.
 * `statuses`/`isRenewal` let a caller scope this to one queue's shape (e.g.
 * only FOR_APPROVAL items for the Account Officer) instead of the default
 * pre-assessment mix. */
function attentionQueue(
  applications,
  { limit = 6, statuses = ["SUBMITTED", "RESUBMITTED"], isRenewal } = {}
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

// Shares Permit.js's window so a permit and a contract are flagged "about to
// expire" on the same timeline (currently: less than 12 months left).
const EXPIRY_ATTENTION_WINDOW_DAYS = Permit.EXPIRING_WINDOW_DAYS;

// The "Needs Attention" card now carries a Critical/Warning filter on the
// frontend, so it needs every expiring/overdue item — not just the top few —
// or a critical item could be hidden behind the old 6-row cap. A generous
// ceiling still bounds the payload; the card scrolls past ~5 rows.
const ATTENTION_MAX = 100;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Permits/contracts already expired or expiring within the window, for the
 * Account Officer's "Needs Your Attention" widget — renewal isn't just about
 * new applications waiting in the queue, it's also about what's about to
 * lapse. Expired-first, then soonest-to-expire.
 *
 * For a staff role: permits only when it can open the Permits page
 * (`includePermits`), and contracts only for applications in its own queue
 * (`applicationIds`) — never another officer's records. Defaults (admin):
 * everything. */
async function buildExpiryAttentionItems(limit, { includePermits = true, applicationIds = null } = {}) {
  const [permits, contracts] = await Promise.all([includePermits ? Permit.listAll() : [], Contract.listAll()]);

  const permitItems = permits
    .filter((p) => p.effective_status === "EXPIRING" || p.effective_status === "EXPIRED")
    .map((p) => {
      const days = daysUntil(p.expiry_date);
      return {
        kind: "permit",
        // The permit's own id — used to deep-link/highlight it on the
        // Permits page. Keep separate from application_id (which a
        // CONTRACT-type permit does have, but that's the *application's*
        // id, not this permit's — conflating the two here used to make
        // navigation land on an unrelated record).
        permit_id: p.id,
        application_id: p.application_id || p.id,
        application_no: `Permit ${p.permit_no}`,
        proponent_name: p.proponent_name,
        status: p.effective_status,
        is_expired: p.effective_status === "EXPIRED",
        days_waiting: days === null ? 0 : Math.abs(days),
        link: `/compliance/permits?permitId=${p.id}`,
      };
    });

  const contractItems = contracts
    .filter((c) => !applicationIds || applicationIds.has(Number(c.application_id)))
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
      link: `/approval?applicationId=${c.application_id}`,
    }));

  return [...permitItems, ...contractItems]
    .sort((a, b) => (a.is_expired === b.is_expired ? a.days_waiting - b.days_waiting : a.is_expired ? -1 : 1))
    .slice(0, limit);
}

/** Which queue (if any) a staff role works, from its Control Panel menu
 * access — never its name, so renamed and custom roles behave the same.
 * Approval wins when a role has both, same as before. */
function queueKind(menus) {
  if (menus.has("approval:queue")) return "approval";
  if (menus.has("assessment:queue")) return "assessment";
  return null;
}

/** Where a dashboard row should open for this role: the queue page it works
 * in (a DRAFT is in neither queue), else the Applications page for that row's type if the role can open
 * it, else nowhere (the row isn't clickable rather than leading to a page
 * the role would be refused). */
function rowLinker(queue, menus) {
  return (applicationId, isRenewal, status) => {
    const isDraft = upper(status) === "DRAFT";
    if (queue === "approval" && !isDraft) return `/approval?applicationId=${applicationId}`;
    if (queue === "assessment" && !isDraft) return `/assessment?applicationId=${applicationId}`;
    const menu = isRenewal ? "applications:renewals" : "applications:new";
    return menus.has(menu) ? `/applications/${isRenewal ? "renewals" : "new"}?applicationId=${applicationId}` : null;
  };
}

function daysSince(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

/** The stat-card values each card needs — only visible cards' values are sent. */
const STAT_FIELDS = {
  "dashboard:stats:total": ["total"],
  "dashboard:stats:pending": ["pending"],
  "dashboard:stats:approved": ["approved"],
  "dashboard:stats:disapproved": ["disapproved"],
  "dashboard:stats:rejected": ["rejected"],
  "dashboard:stats:returned": ["returned"],
  "dashboard:stats:requirements": ["requirementsTotal", "requirementsVerified"],
};

/**
 * The dashboard every non-admin staff role shares (Account Officer,
 * Assessment Officer, Viewer, or any custom role), scoped by the queue the
 * role works:
 *   - Approval   -> this officer's Approval queue (assigned to them or
 *                   unassigned — the same rule as the queue itself);
 *   - Assessment -> a Level 2 Officer's own assignments, else (Level 1
 *                   Manager) new applications;
 *   - neither    -> every application (a read-only overview role).
 * Only widgets the role is eligible for AND has on (lib/dashboardWidgets.js)
 * are computed and sent — a hidden widget's data never leaves the server.
 *
 * `user` is null for the admin's identity-less preview: the Approval preview
 * then shows the whole Approval queue, and the Assessment preview a Level 1
 * Manager's view.
 */
async function buildStaffDashboard({ user, sidebarPermissions, widgetPermissions }) {
  const menus = DashboardWidgets.enabledMenus(sidebarPermissions);
  const widgets = DashboardWidgets.resolveVisibility(sidebarPermissions, widgetPermissions);
  const queue = queueKind(menus);
  const linkFor = rowLinker(queue, menus);
  // Nothing to show (e.g. a role with no menu access yet) — skip every query.
  if (!Object.values(widgets).some(Boolean)) return { view: "overview", widgets };

  let isManager = !user;
  let scopeIds = null;
  if (queue === "approval") {
    scopeIds = await Approval.listApplicationIdsInQueue(user?.id ?? null);
  } else if (queue === "assessment" && user) {
    if (await Assessment.isScopedLevel2(user.id, sidebarPermissions)) {
      scopeIds = await Assessment.listApplicationIdsAssignedTo(user.id);
    } else {
      isManager = true;
    }
  }

  const allApplications = await Workflow.listAllApplicationsWithProgress();
  const applications = allApplications.filter((a) => {
    if (scopeIds) return scopeIds.has(Number(a.id));
    // Level 1 Managers keep the new-applications-only list they had
    // before; renewals waiting on them still show in Needs Attention.
    if (queue === "assessment") return !Number(a.is_renewal);
    return true;
  });
  // An overview role sees everything, so its aggregates need no id filter.
  const scopedIds = queue ? applications.map((a) => a.id) : null;
  const summary = summarize(applications);

  // Drives the dashboard's heading/wording, e.g. a read-only overview role
  // never sees "assigned to you".
  const view =
    queue === "approval" ? "approval" : queue === "assessment" ? (isManager ? "assessment-manager" : "assessment-officer") : "overview";
  const data = { view, widgets };

  if (widgets["dashboard:stats"]) {
    const stats = {};
    for (const [key, fields] of Object.entries(STAT_FIELDS)) {
      if (widgets[key]) fields.forEach((f) => { stats[f] = summary[f]; });
    }
    data.stats = stats;
  }

  if (widgets["dashboard:status-chart"]) {
    const { pending, approved, disapproved, rejected, returned } = summary;
    data.statusBreakdown = { pending, approved, disapproved, rejected, returned };
  }

  if (widgets["dashboard:pipeline"]) data.trends = buildTrends(applications);

  const [turnaround, categoryCompletion] = await Promise.all([
    widgets["dashboard:performance"] ? Workflow.getApplicationTurnaroundStats(scopedIds) : null,
    widgets["dashboard:requirements"] ? Workflow.getRequirementCompletionByCategory(scopedIds) : null,
  ]);
  if (turnaround) data.turnaround = turnaround;
  if (categoryCompletion) {
    data.categoryCompletion = categoryCompletion;
    data.canOpenRequirements = menus.has("applications:requirements");
  }

  if (widgets["dashboard:table"]) {
    data.applications = applications.map((a) => ({ ...a, link: linkFor(a.id, Boolean(Number(a.is_renewal)), a.status) }));
  }

  if (widgets["dashboard:attention"]) {
    const withLinks = (items) => items.map((i) => ({ ...i, link: linkFor(i.application_id, i.is_renewal, i.status) }));
    if (queue === "approval") {
      const expiryItems = await buildExpiryAttentionItems(ATTENTION_MAX, {
        includePermits: menus.has("compliance:permits"),
        applicationIds: scopeIds,
      });
      data.attention = [
        ...expiryItems,
        ...withLinks(attentionQueue(applications, { statuses: ["FOR_APPROVAL"], limit: ATTENTION_MAX })),
      ].slice(0, ATTENTION_MAX);
    } else if (queue === "assessment" && !isManager) {
      data.attention = withLinks(attentionQueue(applications, { statuses: ["SUBMITTED", "RESUBMITTED", "RETURNED"], limit: ATTENTION_MAX }));
    } else if (queue === "assessment") {
      const rows = await Assessment.listManagerAttention();
      data.attention = rows
        .map((r) => ({
          application_id: r.application_id,
          application_no: r.application_no,
          proponent_name: r.proponent_name,
          status: r.stage === "FOR_RECOMMENDATION" ? "AWAITING RECOMMENDATION" : "NEEDS ASSIGNMENT",
          is_renewal: Boolean(Number(r.is_renewal)),
          days_waiting: daysSince(r.waiting_since),
          link: `/assessment?applicationId=${r.application_id}`,
        }))
        .sort((a, b) => b.days_waiting - a.days_waiting)
        .slice(0, ATTENTION_MAX);
    }
  }

  return data;
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
      const [applications, proponents, categoryCompletion, turnaround, expiryItems] = await Promise.all([
        Workflow.listAllApplicationsWithProgress(),
        Proponent.listProponents(),
        Workflow.getRequirementCompletionByCategory(),
        Workflow.getApplicationTurnaroundStats(),
        buildExpiryAttentionItems(ATTENTION_MAX),
      ]);
      // Same merge the Approval-queue staff dashboard does — admin's "Needs
      // Attention" also surfaces permits/contracts about to expire.
      return res.json({
        success: true,
        role,
        data: {
          ...summarizeAdmin(applications, proponents),
          categoryCompletion,
          turnaround,
          attention: [...expiryItems, ...attentionQueue(applications, { limit: ATTENTION_MAX })].slice(0, ATTENTION_MAX),
        },
      });
    }

    // Every other role — Account Officer, Assessment Officer, Viewer, or any
    // future custom staff role — shares one dashboard, scoped and trimmed by
    // its Control Panel permissions (see buildStaffDashboard).
    const roleId = await Role.getActiveRoleIdByName(role);
    const [sidebarPermissions, widgetPermissions] = roleId
      ? await Promise.all([
          ControlPanelPermission.getSidebarPermissions(roleId),
          ControlPanelPermission.getDashboardWidgetPermissions(roleId),
        ])
      : [[], []];
    const data = await buildStaffDashboard({ user: req.user, sidebarPermissions, widgetPermissions });
    return res.json({ success: true, role: "officer", data });
  } catch (error) {
    console.error("Get my dashboard error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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

    // Any other value is a role ID — Account Officer, Assessment Officer,
    // Viewer, or any future custom staff role, all sharing the same staff
    // dashboard; what differs is driven by that exact role's own Control
    // Panel permissions. ID rather than name: these roles (unlike the fixed
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
    const [widgetPermissions, sidebarPermissions] = await Promise.all([
      ControlPanelPermission.getDashboardWidgetPermissions(roleId),
      ControlPanelPermission.getSidebarPermissions(roleId),
    ]);
    const data = await buildStaffDashboard({ user: null, sidebarPermissions, widgetPermissions });
    return res.json({ success: true, role: "officer", widgetPermissions, sidebarPermissions, data });
  } catch (error) {
    console.error("Get dashboard preview error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
