const Department = require("../models/Department");

function fail(res, label, error) {
  console.error(`${label} error:`, error);
  const duplicate = /unique|duplicate/i.test(error?.message || "");
  return res.status(duplicate ? 409 : 500).json({
    success: false,
    message: duplicate ? "A department with that code already exists." : error.message || "Internal server error",
  });
}

exports.list = async (req, res) => {
  try {
    return res.json({ success: true, data: await Department.listDepartments() });
  } catch (error) {
    return fail(res, "List departments", error);
  }
};

exports.create = async (req, res) => {
  try {
    const { code, name, is_active } = req.body || {};
    if (!code || !String(code).trim()) return res.status(400).json({ success: false, message: "code is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await Department.createDepartment({
      code: String(code).trim().toUpperCase(),
      name: String(name).trim(),
      created_by: req.user?.id ?? null,
      is_active,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Create department", error);
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { code, name, is_active } = req.body || {};
    const row = await Department.updateDepartment(id, {
      code: code !== undefined ? String(code).trim().toUpperCase() : undefined,
      name: name !== undefined ? String(name).trim() : undefined,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Department not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Update department", error);
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Department.deactivateDepartment(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Department not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Deactivate department", error);
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Department.reactivateDepartment(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Department not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, "Reactivate department", error);
  }
};
