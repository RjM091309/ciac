const ComplianceRequirement = require("../models/ComplianceRequirement");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "compliance_requirement",
    entityId,
    details,
    req,
  });
}

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
}

function idOf(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, message: "Invalid id" });
    return null;
  }
  return id;
}

exports.list = async (req, res) => {
  try {
    const rows = await ComplianceRequirement.listRequirements();
    return res.json({ success: true, data: rows });
  } catch (error) {
    return fail(res, error, "List compliance requirements");
  }
};

exports.create = async (req, res) => {
  try {
    const { code, name, category, sort_order, description } = req.body || {};
    if (!String(code ?? "").trim()) return res.status(400).json({ success: false, message: "code is required" });
    if (!String(name ?? "").trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await ComplianceRequirement.createRequirement({
      code,
      name,
      category,
      sort_order,
      description,
      created_by: req.user?.id ?? null,
    });
    await audit(req, "COMPLIANCE_REQUIREMENT_CREATED", row?.id, { code: row?.code, name: row?.name, category: row?.category });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Create compliance requirement");
  }
};

exports.update = async (req, res) => {
  try {
    const id = idOf(req, res);
    if (id === null) return undefined;
    const { name, category, sort_order, description } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, message: "name cannot be empty" });
    }
    const row = await ComplianceRequirement.updateRequirement(id, {
      name,
      category,
      sort_order,
      description,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    await audit(req, "COMPLIANCE_REQUIREMENT_UPDATED", id, { code: row.code, name: row.name, category: row.category });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Update compliance requirement");
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = idOf(req, res);
    if (id === null) return undefined;
    const row = await ComplianceRequirement.setActive(id, false, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    await audit(req, "COMPLIANCE_REQUIREMENT_DEACTIVATED", id, { code: row.code, name: row.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Deactivate compliance requirement");
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = idOf(req, res);
    if (id === null) return undefined;
    const row = await ComplianceRequirement.setActive(id, true, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    await audit(req, "COMPLIANCE_REQUIREMENT_REACTIVATED", id, { code: row.code, name: row.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Reactivate compliance requirement");
  }
};
