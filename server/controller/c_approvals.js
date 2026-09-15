const fs = require("fs");
const Approval = require("../models/ApprovalIssuance");
const Contract = require("../models/Contract");
const { resolveStoredPath } = require("../lib/fileStorage");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: error.message || "Internal server error" });
}

function appIdParam(req, res) {
  const id = Number(req.params.applicationId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, message: "Invalid application id" });
    return null;
  }
  return id;
}

function idParam(req, res, label = "id") {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, message: `Invalid ${label}` });
    return null;
  }
  return id;
}

/* --------------------------------- Queue ---------------------------------- */

exports.list = async (req, res) => {
  try {
    const rows = await Approval.listApprovals({ status: req.query.status, search: req.query.search });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return fail(res, error, "List approvals");
  }
};

exports.summary = async (req, res) => {
  try {
    return res.json({ success: true, data: await Approval.getSummary() });
  } catch (error) {
    return fail(res, error, "Approval summary");
  }
};

exports.approvers = async (req, res) => {
  try {
    return res.json({ success: true, data: await Approval.listApprovers() });
  } catch (error) {
    return fail(res, error, "List approvers");
  }
};

exports.detail = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    let data = await Approval.getApprovalDetail(id);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    // Self-healing: an application that's reached FOR_APPROVAL but hasn't had
    // its routing ladder started yet (freshly endorsed before this auto-start
    // existed, or any other gap) gets started the moment someone opens it —
    // no one should ever need to press "Start approval routing" by hand.
    if (data.approval.application_status === "FOR_APPROVAL" && data.approval.approval_status === "PENDING") {
      const started = await Approval.startApproval(id, req.user?.id ?? null).catch((error) => {
        console.error("Auto-start approval on view error:", error);
        return null;
      });
      if (started) data = started;
    }
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Approval detail");
  }
};

/* ---------------------------- Header / ladder ---------------------------- */

exports.start = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    const data = await Approval.startApproval(id, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Start approval");
  }
};

exports.reopen = async (req, res) => {
  try {
    if (String(req.user?.role || "").toLowerCase() !== "admin") {
      return res.status(403).json({ success: false, message: "Only an admin can reopen an approval" });
    }
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    const data = await Approval.reopenApproval(id, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reopen approval");
  }
};

exports.actOnStep = async (req, res) => {
  try {
    const id = idParam(req, res, "step id");
    if (id === null) return undefined;
    const { action, remarks } = req.body || {};
    const data = await Approval.actOnStep(id, { action, remarks, actorId: req.user?.id ?? null });
    if (!data) return res.status(404).json({ success: false, message: "Approval step not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Act on approval step");
  }
};

exports.endorseStep = async (req, res) => {
  try {
    const id = idParam(req, res, "step id");
    if (id === null) return undefined;
    const { office, note, assign_to_user_id } = req.body || {};
    if (!office || !String(office).trim()) {
      return res.status(400).json({ success: false, message: "office is required" });
    }
    const data = await Approval.endorseStep(id, {
      office,
      note,
      assignToUserId: assign_to_user_id,
      actorId: req.user?.id ?? null,
    });
    if (!data) return res.status(404).json({ success: false, message: "Approval step not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Endorse approval step");
  }
};

exports.assignStep = async (req, res) => {
  try {
    const id = idParam(req, res, "step id");
    if (id === null) return undefined;
    const { user_id } = req.body || {};
    const data = await Approval.assignStep(id, user_id, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Approval step not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Assign approval step");
  }
};

/* -------------------------------- Issuance ------------------------------- */

exports.addIssuance = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!String(req.body?.title ?? "").trim()) {
      return res.status(400).json({ success: false, message: "title is required" });
    }
    const row = await Approval.addIssuance(id, req.body || {}, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Add issuance");
  }
};

exports.deleteIssuance = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const ok = await Approval.deleteIssuance(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Issuance not found" });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete issuance");
  }
};

exports.saveContract = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    const row = await Approval.saveContract(id, req.body || {}, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Save contract");
  }
};

/** Serves the auto-generated contract certificate PDF — ?view=1 renders it
 * inline in the browser, otherwise it downloads. Mirrors
 * c_permits.js's downloadCertificate. */
exports.downloadContractCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const certificatePath = await Contract.getCertificatePath(id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this contract yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Contract-Certificate-${id}.pdf`;
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    return fail(res, error, "Download contract certificate");
  }
};

exports.previewContractNo = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    const contractNo = await Approval.previewContractNo(id);
    if (!contractNo) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: { contract_no: contractNo } });
  } catch (error) {
    return fail(res, error, "Preview contract number");
  }
};

/* ---------------------------------- Charges -------------------------------- */

exports.addCharge = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!String(req.body?.description ?? "").trim()) {
      return res.status(400).json({ success: false, message: "description is required" });
    }
    const data = await Approval.addCharge(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Add charge");
  }
};

exports.updateCharge = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Approval.updateCharge(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Charge not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update charge");
  }
};

exports.deleteCharge = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const ok = await Approval.deleteCharge(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Charge not found" });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete charge");
  }
};

/* --------------------------- Configurable levels ------------------------- */

exports.listLevels = async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || "") === "1";
    return res.json({ success: true, data: await Approval.listLevels({ includeInactive }) });
  } catch (error) {
    return fail(res, error, "List approval levels");
  }
};

exports.createLevel = async (req, res) => {
  try {
    const { level_no, name, role_hint } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    const row = await Approval.createLevel({ level_no, name, role_hint, actorId: req.user?.id ?? null });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Create approval level");
  }
};

exports.updateLevel = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const row = await Approval.updateLevel(id, req.body || {}, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Approval level not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Update approval level");
  }
};

exports.deleteLevel = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const ok = await Approval.deleteLevel(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Approval level not found" });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete approval level");
  }
};
