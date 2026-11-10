const PropertyType = require("../models/PropertyType");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "property_type",
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
    message: duplicate ? "A type of property with that name already exists." : publicErrorMessage(error),
  });
}

exports.list = async (req, res) => {
  try {
    return res.json({ success: true, data: await PropertyType.listPropertyTypes() });
  } catch (error) {
    return fail(res, "List type of property", error);
  }
};

exports.create = async (req, res) => {
  try {
    const { name, is_active } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await PropertyType.createPropertyType({
      name: String(name).trim().toUpperCase(),
      created_by: req.user?.id ?? null,
      is_active,
    });
    await audit(req, "PROPERTY_TYPE_CREATED", row?.id, { name: row?.name });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Create type of property", error);
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
    const row = await PropertyType.updatePropertyType(id, {
      name: name !== undefined ? String(name).trim().toUpperCase() : undefined,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Type of Property not found" });
    await audit(req, "PROPERTY_TYPE_UPDATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Update type of property", error);
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await PropertyType.deactivatePropertyType(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Type of Property not found" });
    await audit(req, "PROPERTY_TYPE_DEACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Deactivate type of property", error);
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await PropertyType.reactivatePropertyType(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Type of Property not found" });
    await audit(req, "PROPERTY_TYPE_REACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Reactivate type of property", error);
  }
};
