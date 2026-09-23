const TypeOfContract = require("../models/TypeOfContract");
const AuditLog = require("../models/AuditLog");

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "type_of_contract",
    entityId,
    details,
    req,
  });
}

function fail(res, label, error) {
  console.error(`${label} error:`, error);
  const duplicate = /unique|duplicate/i.test(error?.message || "");
  return res.status(duplicate ? 409 : 500).json({
    success: false,
    message: duplicate ? "A type of contract with that name already exists." : error.message || "Internal server error",
  });
}

exports.list = async (req, res) => {
  try {
    return res.json({ success: true, data: await TypeOfContract.listTypeOfContracts() });
  } catch (error) {
    return fail(res, "List type of contract", error);
  }
};

exports.create = async (req, res) => {
  try {
    const { name, is_active } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await TypeOfContract.createTypeOfContract({
      name: String(name).trim().toUpperCase(),
      created_by: req.user?.id ?? null,
      is_active,
    });
    await audit(req, "TYPE_OF_CONTRACT_CREATED", row?.id, { name: row?.name });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Create type of contract", error);
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { name, is_active } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    const row = await TypeOfContract.updateTypeOfContract(id, {
      name: name !== undefined ? String(name).trim().toUpperCase() : undefined,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Type of Contract not found" });
    await audit(req, "TYPE_OF_CONTRACT_UPDATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Update type of contract", error);
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await TypeOfContract.deactivateTypeOfContract(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Type of Contract not found" });
    await audit(req, "TYPE_OF_CONTRACT_DEACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Deactivate type of contract", error);
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await TypeOfContract.reactivateTypeOfContract(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Type of Contract not found" });
    await audit(req, "TYPE_OF_CONTRACT_REACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Reactivate type of contract", error);
  }
};
