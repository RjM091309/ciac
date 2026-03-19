const Workflow = require("../models/ApplicationWorkflow");

exports.list = async (req, res) => {
  try {
    const rows = await Workflow.listApplications();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List applications error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Workflow.getApplicationById(id);
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get application error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { proponent_id, application_no, application_type, is_renewal, status, submitted_at, current_officer_id } = req.body || {};
    if (!Number.isFinite(Number(proponent_id))) {
      return res.status(400).json({ success: false, message: "proponent_id is required" });
    }
    if (!application_no || !String(application_no).trim()) {
      return res.status(400).json({ success: false, message: "application_no is required" });
    }
    if (!application_type || !String(application_type).trim()) {
      return res.status(400).json({ success: false, message: "application_type is required" });
    }

    const row = await Workflow.createApplication({
      proponent_id,
      application_no: String(application_no).trim(),
      application_type: String(application_type).trim(),
      is_renewal: Number(is_renewal) ? 1 : 0,
      status: status ? String(status).trim() : "SUBMITTED",
      submitted_at: submitted_at ?? null,
      current_officer_id,
      created_by: req.user?.id ?? null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create application error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { to_status, remarks } = req.body || {};
    if (!to_status || !String(to_status).trim()) {
      return res.status(400).json({ success: false, message: "to_status is required" });
    }
    const row = await Workflow.updateApplicationStatus(id, {
      to_status: String(to_status).trim(),
      remarks: remarks ?? null,
      changed_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update application status error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listRequirements = async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId)) return res.status(400).json({ success: false, message: "Invalid application id" });
    const rows = await Workflow.listApplicationRequirements(applicationId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List application requirements error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.updateRequirementStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { status, remarks } = req.body || {};
    if (!status || !String(status).trim()) {
      return res.status(400).json({ success: false, message: "status is required" });
    }

    const row = await Workflow.updateApplicationRequirementStatus(id, {
      status: String(status).trim(),
      remarks: remarks ?? null,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application requirement not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update application requirement status error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listDocuments = async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId)) return res.status(400).json({ success: false, message: "Invalid application id" });
    const rows = await Workflow.listDocumentsByApplication(applicationId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List documents error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.createDocument = async (req, res) => {
  try {
    const { application_id, requirement_id, file_name, original_file_name, storage_path, content_type, file_size_bytes } = req.body || {};
    if (!Number.isFinite(Number(application_id))) {
      return res.status(400).json({ success: false, message: "application_id is required" });
    }
    if (!file_name || !String(file_name).trim()) {
      return res.status(400).json({ success: false, message: "file_name is required" });
    }
    if (!storage_path || !String(storage_path).trim()) {
      return res.status(400).json({ success: false, message: "storage_path is required" });
    }

    const row = await Workflow.createDocument({
      application_id,
      requirement_id,
      file_name: String(file_name).trim(),
      original_file_name: original_file_name ?? null,
      storage_path: String(storage_path).trim(),
      content_type: content_type ?? null,
      file_size_bytes,
      created_by: req.user?.id ?? null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create document error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listStatusHistory = async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId)) return res.status(400).json({ success: false, message: "Invalid application id" });
    const rows = await Workflow.listApplicationStatusHistory(applicationId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List status history error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
