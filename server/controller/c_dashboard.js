const Workflow = require("../models/ApplicationWorkflow");
const Proponent = require("../models/Proponent");

function summarize(applications) {
  const total = applications.length;
  const pending = applications.filter((a) => !["APPROVED", "REJECTED"].includes(String(a.status).toUpperCase())).length;
  const approved = applications.filter((a) => String(a.status).toUpperCase() === "APPROVED").length;
  const requirementsTotal = applications.reduce((sum, a) => sum + Number(a.requirements_total || 0), 0);
  const requirementsVerified = applications.reduce((sum, a) => sum + Number(a.requirements_verified || 0), 0);
  return { total, pending, approved, requirementsTotal, requirementsVerified };
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// System-wide overview for the admin dashboard: real counts instead of mock data.
function summarizeAdmin(applications, proponents) {
  const totalApplications = applications.length;
  const newApplications = applications.filter((a) => !Number(a.is_renewal)).length;
  const renewalApplications = applications.filter((a) => Number(a.is_renewal)).length;

  const statusBreakdown = { pending: 0, approved: 0, rejected: 0, returned: 0 };
  for (const a of applications) {
    const status = String(a.status || "").toUpperCase();
    if (status === "APPROVED") statusBreakdown.approved += 1;
    else if (status === "REJECTED") statusBreakdown.rejected += 1;
    else if (status === "RETURNED") statusBreakdown.returned += 1;
    else statusBreakdown.pending += 1;
  }

  const requirementsTotal = applications.reduce((sum, a) => sum + Number(a.requirements_total || 0), 0);
  const requirementsVerified = applications.reduce((sum, a) => sum + Number(a.requirements_verified || 0), 0);

  const now = new Date();
  const todayKey = now.toDateString();
  const applicationsToday = applications.filter((a) => {
    const created = a.created_at ? new Date(a.created_at) : null;
    return created && !Number.isNaN(created.getTime()) && created.toDateString() === todayKey;
  }).length;

  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: monthKey(d),
      label: d.toLocaleDateString("en-US", { month: "short" }),
      total: 0,
      approved: 0,
    });
  }
  const monthByKey = new Map(months.map((m) => [m.key, m]));
  for (const a of applications) {
    const created = a.created_at ? new Date(a.created_at) : null;
    if (!created || Number.isNaN(created.getTime())) continue;
    const bucket = monthByKey.get(monthKey(created));
    if (!bucket) continue;
    bucket.total += 1;
    if (String(a.status || "").toUpperCase() === "APPROVED") bucket.approved += 1;
  }

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
    requirements: { total: requirementsTotal, verified: requirementsVerified },
    monthlyTrend: months.map(({ key, ...rest }) => rest),
  };
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

    if (role === "officer") {
      const applications = await Workflow.listApplicationsForOfficer(req.user.id);
      return res.json({
        success: true,
        role: "officer",
        data: { applications, stats: summarize(applications) },
      });
    }

    // admin (or any other exempt role): real system-wide overview.
    const [applications, proponents, categoryCompletion] = await Promise.all([
      Workflow.listAllApplicationsWithProgress(),
      Proponent.listProponents(),
      Workflow.getRequirementCompletionByCategory(),
    ]);
    return res.json({
      success: true,
      role,
      data: { ...summarizeAdmin(applications, proponents), categoryCompletion },
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
    const previewRole = String(req.params.role || "").toLowerCase();

    if (previewRole === "account-officer" || previewRole === "officer") {
      const applications = await Workflow.listAllApplicationsWithProgress();
      return res.json({
        success: true,
        role: "officer",
        data: { applications, stats: summarize(applications) },
      });
    }

    if (previewRole === "proponent") {
      const proponentId = await Workflow.getMostActiveProponentId();
      if (!proponentId) {
        return res.json({
          success: true,
          role: "proponent",
          data: { proponent: null, applications: [], stats: summarize([]) },
        });
      }
      const [proponent, applications] = await Promise.all([
        Proponent.getProponentById(proponentId),
        Workflow.listApplicationsForProponent(proponentId),
      ]);
      return res.json({
        success: true,
        role: "proponent",
        data: { proponent, applications, stats: summarize(applications) },
      });
    }

    return res.status(400).json({ success: false, message: "Unknown preview role" });
  } catch (error) {
    console.error("Get dashboard preview error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
