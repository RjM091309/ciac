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

    // admin (or any other exempt role) keeps the existing system-wide dashboard view.
    return res.json({ success: true, role, data: null });
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
