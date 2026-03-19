const Contract = require("../models/Contract");

exports.getByApplicationId = async (req, res) => {
  try {
    const applicationId = Number(req.params.applicationId);
    if (!Number.isFinite(applicationId)) {
      return res.status(400).json({ success: false, message: "Invalid application id" });
    }
    const row = await Contract.getByApplicationId(applicationId);
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get contract error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Contract.getById(id);
    if (!row) return res.status(404).json({ success: false, message: "Contract not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get contract error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { application_id, contract_no, issue_date, effective_start, effective_end, document_id } = req.body || {};

    if (!Number.isFinite(Number(application_id))) {
      return res.status(400).json({ success: false, message: "application_id is required" });
    }
    if (!contract_no || !String(contract_no).trim()) {
      return res.status(400).json({ success: false, message: "contract_no is required" });
    }
    if (!issue_date) {
      return res.status(400).json({ success: false, message: "issue_date is required" });
    }

    const row = await Contract.createContract({
      application_id,
      contract_no: String(contract_no).trim(),
      issue_date,
      effective_start: effective_start ?? null,
      effective_end: effective_end ?? null,
      document_id: document_id ?? null,
      created_by: req.user?.id ?? null,
    });

    if (!row) return res.status(500).json({ success: false, message: "Failed to create contract" });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create contract error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { contract_no, issue_date, effective_start, effective_end, document_id } = req.body || {};

    if (!contract_no || !String(contract_no).trim()) {
      return res.status(400).json({ success: false, message: "contract_no is required" });
    }
    if (!issue_date) {
      return res.status(400).json({ success: false, message: "issue_date is required" });
    }

    const row = await Contract.updateContract(id, {
      contract_no: String(contract_no).trim(),
      issue_date,
      effective_start: effective_start ?? null,
      effective_end: effective_end ?? null,
      document_id: document_id ?? null,
      updated_by: req.user?.id ?? null,
    });

    if (!row) return res.status(404).json({ success: false, message: "Contract not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update contract error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

