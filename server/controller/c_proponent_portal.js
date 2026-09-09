const fs = require("fs");
const Workflow = require("../models/ApplicationWorkflow");
const Contract = require("../models/Contract");
const Permit = require("../models/Permit");
const ActivityLog = require("../models/ActivityLog");
const { relativeStoragePath } = require("../lib/fileStorage");

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

    let requirementId = Number(req.body?.requirement_id);
    if (!Number.isFinite(requirementId) || requirementId <= 0) {
      requirementId = null;
    } else {
      // Guard: the requirement must belong to this application's checklist.
      const reqs = await Workflow.listApplicationRequirements(req.application.id);
      const match = reqs.find((r) => Number(r.requirement_id) === requirementId);
      if (!match) requirementId = null;
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

exports.listMyPermits = async (req, res) => {
  try {
    const rows = await Permit.listByProponent(req.proponent.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List my permits error:", error);
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
