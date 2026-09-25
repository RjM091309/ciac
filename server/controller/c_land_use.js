const LandUse = require("../models/LandUse");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "land_use",
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
    message: duplicate ? "A land use with that name already exists." : publicErrorMessage(error),
  });
}

exports.list = async (req, res) => {
  try {
    return res.json({ success: true, data: await LandUse.listLandUses() });
  } catch (error) {
    return fail(res, "List land use", error);
  }
};

exports.create = async (req, res) => {
  try {
    const { name, is_active } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await LandUse.createLandUse({
      name: String(name).trim().toUpperCase(),
      created_by: req.user?.id ?? null,
      is_active,
    });
    await audit(req, "LAND_USE_CREATED", row?.id, { name: row?.name });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Create land use", error);
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
    const row = await LandUse.updateLandUse(id, {
      name: name !== undefined ? String(name).trim().toUpperCase() : undefined,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Land Use not found" });
    await audit(req, "LAND_USE_UPDATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Update land use", error);
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await LandUse.deactivateLandUse(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Land Use not found" });
    await audit(req, "LAND_USE_DEACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Deactivate land use", error);
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await LandUse.reactivateLandUse(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Land Use not found" });
    await audit(req, "LAND_USE_REACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Reactivate land use", error);
  }
};
