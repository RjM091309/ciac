const fs = require("fs");
const Workflow = require("../models/ApplicationWorkflow");
const Contract = require("../models/Contract");
const Permit = require("../models/Permit");
const ActivityLog = require("../models/ActivityLog");
const AuditLog = require("../models/AuditLog");
const { relativeStoragePath, resolveStoredPath } = require("../lib/fileStorage");

// All handlers below assume requireProponentSelf (req.proponent) has run, and
// the per-application ones assume requireOwnApplication (req.application) has run.

exports.listMyApplications = async (req, res) => {
  try {
    const applications = await Workflow.listApplicationsForProponent(req.proponent.id);
    return res.json({ success: true, data: applications });
  } catch (error) {
    console.error("List my applications error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyApplication = async (req, res) => {
  return res.json({ success: true, data: req.application });
};

exports.getMyApplicationRequirements = async (req, res) => {
  try {
    const rows = await Workflow.listApplicationRequirements(req.application.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application requirements error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyApplicationDocuments = async (req, res) => {
  try {
    const rows = await Workflow.listDocumentsByApplication(req.application.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application documents error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Proponent uploads a supporting document to their own application.
// `handleUpload` (multer) has already written the file to disk and set req.file.
exports.uploadMyApplicationDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file was uploaded." });
    }

    const requirementId = Number(req.body?.requirement_id);
    if (!Number.isFinite(requirementId) || requirementId <= 0) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "Select which requirement this document is for." });
    }
    // Guard: the requirement must belong to this application's checklist.
    const reqs = await Workflow.listApplicationRequirements(req.application.id);
    const match = reqs.find((r) => Number(r.requirement_id) === requirementId);
    if (!match) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "That requirement doesn't belong to this application." });
    }

    const document = await Workflow.createDocument({
      application_id: req.application.id,
      requirement_id: requirementId,
      file_name: req.file.filename,
      original_file_name: req.file.originalname,
      storage_path: relativeStoragePath(req.file.path),
      content_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      created_by: req.user?.id ?? null,
    });

    ActivityLog.recordFromReq(req, {
      entityType: "DOCUMENT",
      entityId: document?.id ?? null,
      action: "DOCUMENT_UPLOADED",
      meta: { application_id: req.application.id, file_name: req.file.originalname, requirement_id: requirementId },
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "DOCUMENT_UPLOADED",
      entityType: "application",
      entityId: req.application.id,
      details: { application_no: req.application.application_no, file_name: req.file.originalname, uploaded_by: "locator" },
      req,
    });

    return res.status(201).json({ success: true, data: document });
  } catch (error) {
    console.error("Upload my application document error:", error);
    // Best-effort cleanup of the orphaned file.
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyApplicationStatusHistory = async (req, res) => {
  try {
    const rows = await Workflow.listApplicationStatusHistory(req.application.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application status history error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyApplicationContract = async (req, res) => {
  try {
    const contract = await Contract.getByApplicationId(req.application.id);
    return res.json({ success: true, data: contract || null });
  } catch (error) {
    console.error("Get my application contract error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyApplicationPermits = async (req, res) => {
  try {
    const rows = await Permit.listByApplication(req.application.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application permits error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// --- Aggregate "Contracts & Permits" views (across all the proponent's applications) ---

exports.listMyContracts = async (req, res) => {
  try {
    const rows = await Contract.listByProponentId(req.proponent.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List my contracts error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.downloadMyContractCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const contract = await Contract.getById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });
    const application = await Workflow.getApplicationById(contract.application_id);
    if (!application || Number(application.proponent_id) !== Number(req.proponent.id)) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    const certificatePath = await Contract.getCertificatePath(id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this contract yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Contract-Certificate-${id}.pdf`;
    AuditLog.recordFileAccess(req, {
      kind: "CERTIFICATE",
      entityType: "contract",
      entityId: id,
      details: { certificate: "contract", contract_no: contract.contract_no, file_name: filename },
    });
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    console.error("Download my contract certificate error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listMyPermits = async (req, res) => {
  try {
    const rows = await Permit.listByProponent(req.proponent.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List my permits error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.downloadMyPermitCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const permit = await Permit.getById(id);
    if (!permit || Number(permit.proponent_id) !== Number(req.proponent.id)) {
      return res.status(404).json({ success: false, message: "Permit not found" });
    }
    const certificatePath = await Permit.getCertificatePath(id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this permit yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Permit-Certificate-${id}.pdf`;
    AuditLog.recordFileAccess(req, {
      kind: "CERTIFICATE",
      entityType: "permit",
      entityId: id,
      details: { certificate: "permit", permit_no: permit.permit_no, file_name: filename },
    });
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    console.error("Download my permit certificate error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyActivity = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 30;
    const cursor = req.query.cursor;
    const rows = await ActivityLog.listForProponent(req.proponent.id, req.user?.id ?? null, { limit, cursor });
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my activity error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
