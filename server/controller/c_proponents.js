const Proponent = require("../models/Proponent");
const ChangeRequest = require("../models/ProponentChangeRequest");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");

exports.list = async (req, res) => {
  try {
    const rows = await Proponent.listProponents();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List proponents error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Proponent self-service: returns the caller's own linked profile plus any
// pending change request and recent request history.
// `req.proponent` is populated by requireProponentSelf.
exports.getMine = async (req, res) => {
  try {
    const [pendingRequest, requestHistory] = await Promise.all([
      ChangeRequest.getPendingForProponent(req.proponent.id),
      ChangeRequest.listForProponent(req.proponent.id, 10),
    ]);
    return res.json({
      success: true,
      data: req.proponent,
      pendingChangeRequest: pendingRequest,
      changeRequestHistory: requestHistory,
      editableFields: ChangeRequest.EDITABLE_FIELDS,
    });
  } catch (error) {
    console.error("Get my proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Proponent self-service: submits a change request instead of writing the
// profile directly. Rejected if a request is already pending or nothing changed.
exports.updateMine = async (req, res) => {
  try {
    const current = req.proponent;
    const body = req.body || {};

    const existingPending = await ChangeRequest.getPendingForProponent(current.id);
    if (existingPending) {
      return res.status(409).json({
        success: false,
        code: "PENDING_REQUEST_EXISTS",
        message: "You already have a pending change request. Please wait for CIAC to review it.",
      });
    }

    const payload = {};
    for (const field of ChangeRequest.EDITABLE_FIELDS) {
      if (!(field in body)) continue;
      const nextRaw = body[field];
      const next = nextRaw == null ? "" : String(nextRaw).trim();
      const currentValue = current[field] == null ? "" : String(current[field]).trim();
      if (next !== currentValue) payload[field] = next || null;
    }

    if (!payload.business_name && "business_name" in payload) {
      return res.status(400).json({ success: false, message: "Business name cannot be empty." });
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ success: false, message: "No changes to submit." });
    }

    const request = await ChangeRequest.create({
      proponent_id: current.id,
      requested_by: req.user?.id ?? null,
      payload,
    });

    ActivityLog.recordFromReq(req, {
      entityType: "PROPONENT",
      entityId: current.id,
      action: "PROFILE_CHANGE_REQUESTED",
      meta: { fields: Object.keys(payload) },
    });

    try {
      await Notification.createNotification({
        userId: req.user?.id ?? null,
        subject: "Profile change request submitted",
        body: "Your requested changes to your business profile were submitted to CIAC for review.",
        createdBy: req.user?.id ?? null,
        eventType: "application_status",
      });
    } catch (notifyError) {
      console.error("Change request notification error:", notifyError);
    }

    return res.status(202).json({ success: true, data: request });
  } catch (error) {
    console.error("Submit proponent change request error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// --- Admin review of proponent profile change requests ---

exports.listChangeRequests = async (req, res) => {
  try {
    const status = String(req.query.status || "PENDING").toUpperCase();
    const rows = await ChangeRequest.listByStatus(status);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List change requests error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.approveChangeRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const request = await ChangeRequest.getById(id);
    if (!request) return res.status(404).json({ success: false, message: "Change request not found" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This request has already been reviewed." });
    }

    const patch = {};
    for (const field of ChangeRequest.EDITABLE_FIELDS) {
      if (field in request.payload) patch[field] = request.payload[field];
    }
    if (Object.keys(patch).length) {
      await Proponent.updateProponent(request.proponent_id, { ...patch, updated_by: req.user?.id ?? null });
    }

    const remarks = String(req.body?.remarks ?? "").trim() || null;
    const reviewed = await ChangeRequest.markReviewed(id, "APPROVED", req.user?.id ?? null, remarks);

    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: request.proponent_id,
      entityType: "PROPONENT",
      entityId: request.proponent_id,
      action: "PROFILE_CHANGE_APPROVED",
      meta: { request_id: id, fields: Object.keys(patch) },
      ip: req.ip,
    });

    try {
      const proponent = await Proponent.getProponentById(request.proponent_id);
      if (proponent?.user_id) {
        await Notification.createNotification({
          userId: proponent.user_id,
          subject: "Profile change request approved",
          body: "CIAC approved your requested changes. Your business profile has been updated.",
          createdBy: req.user?.id ?? null,
          eventType: "application_status",
        });
      }
    } catch (notifyError) {
      console.error("Approve change request notification error:", notifyError);
    }

    return res.json({ success: true, data: reviewed });
  } catch (error) {
    console.error("Approve change request error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.rejectChangeRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const request = await ChangeRequest.getById(id);
    if (!request) return res.status(404).json({ success: false, message: "Change request not found" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This request has already been reviewed." });
    }

    const remarks = String(req.body?.remarks ?? "").trim() || null;
    const reviewed = await ChangeRequest.markReviewed(id, "REJECTED", req.user?.id ?? null, remarks);

    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: request.proponent_id,
      entityType: "PROPONENT",
      entityId: request.proponent_id,
      action: "PROFILE_CHANGE_REJECTED",
      meta: remarks ? { request_id: id, remarks } : { request_id: id },
      ip: req.ip,
    });

    try {
      const proponent = await Proponent.getProponentById(request.proponent_id);
      if (proponent?.user_id) {
        await Notification.createNotification({
          userId: proponent.user_id,
          subject: "Profile change request declined",
          body: remarks
            ? `CIAC declined your requested profile changes. Note: ${remarks}`
            : "CIAC declined your requested profile changes. Please contact CIAC for details.",
          createdBy: req.user?.id ?? null,
          eventType: "application_status",
        });
      }
    } catch (notifyError) {
      console.error("Reject change request notification error:", notifyError);
    }

    return res.json({ success: true, data: reviewed });
  } catch (error) {
    console.error("Reject change request error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.getProponentById(id);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { user_id, business_name, registration_no, tin, address, contact_no, is_active } = req.body || {};
    if (!business_name) return res.status(400).json({ success: false, message: "business_name is required" });

    const row = await Proponent.createProponent({
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      created_by: req.user?.id ?? null,
      is_active,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { user_id, business_name, registration_no, tin, address, contact_no, is_active } = req.body || {};
    const row = await Proponent.updateProponent(id, {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.deactivateProponent(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.reactivateProponent(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

