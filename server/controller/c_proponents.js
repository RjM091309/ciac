const Proponent = require("../models/Proponent");
const ChangeRequest = require("../models/ProponentChangeRequest");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");
const AuditLog = require("../models/AuditLog");
const { diffChanges } = require("../lib/auditDiff");
const Contract = require("../models/Contract");
const AccountOfficer = require("../models/AccountOfficer");
const TypeOfContract = require("../models/TypeOfContract");
const LandUse = require("../models/LandUse");

/** "", null, undefined -> null; otherwise the id as a number (NaN passes through and is rejected below). */
function toNullableId(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

/** Checks that a submitted lookup id points at a real File Maintenance row. Returns an error message or null. */
async function unknownLookup(id, list, label) {
  if (id === null || id === undefined) return null;
  return (await list()).some((row) => row.id === id) ? null : `Unknown ${label}`;
}

exports.list = async (req, res) => {
  try {
    const rows = await Proponent.listProponents();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List proponents error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Locators/Proponent List page: same underlying proponents, but with
// Business Type / Start-End-Lease Term / Encoded By resolved dynamically
// from the applications/contracts/users tables instead of duplicated data.
exports.listForLocatorList = async (req, res) => {
  try {
    const rows = await Proponent.listProponentsForLocatorList();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List locators error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Lookup for the Account Officer dropdown on the New/Edit Locator form: only
// users holding the ACCOUNT OFFICER role, with their department. Deactivated
// officers are included (flagged) so a locator still assigned to one can show it;
// the form itself only offers active ones for new assignments.
exports.listAccountOfficerOptions = async (req, res) => {
  try {
    const rows = await AccountOfficer.listAccountOfficers();
    return res.json({
      success: true,
      data: rows.map((o) => ({
        id: o.id,
        username: o.username,
        full_name: o.full_name,
        is_active: o.is_active,
        department_code: o.department_code,
        department_name: o.department_name,
      })),
    });
  } catch (error) {
    console.error("List account officer options error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Lookup for the Type of Contract dropdown on the New/Edit Locator form
// (File Maintenance > Type of Contract). Inactive types are included, flagged, so
// a locator whose contract still uses one can display it.
exports.listTypeOfContractOptions = async (req, res) => {
  try {
    const rows = await TypeOfContract.listTypeOfContracts();
    return res.json({
      success: true,
      data: rows.map((t) => ({ id: t.id, name: t.name, is_active: t.is_active })),
    });
  } catch (error) {
    console.error("List type of contract options error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Lookup for the Land Use dropdown on the New/Edit Locator form (File Maintenance > Land
// Use). Inactive rows are included, flagged, so a locator that still uses one can display it.
exports.listLandUseOptions = async (req, res) => {
  try {
    const rows = await LandUse.listLandUses();
    return res.json({ success: true, data: rows.map((r) => ({ id: r.id, name: r.name, is_active: r.is_active })) });
  } catch (error) {
    console.error("List land use options error:", error);
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

// Cheap check the frontend runs right after login (real proponent only) to
// decide whether to show the first-run business profile setup wizard instead
// of the normal portal.
exports.getMySetupStatus = async (req, res) => {
  try {
    const existing = await Proponent.getProponentByUserId(req.user.id);
    return res.json({ success: true, setupComplete: Boolean(existing) });
  } catch (error) {
    console.error("Get proponent setup status error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Proponent self-service, first login only: declares their own business
// profile directly (no approval needed — there's nothing to approve against
// yet). Guarded by requireProponentRole rather than requireProponentSelf,
// since that would 404 before a profile exists. Once a profile exists,
// further edits go through updateMine's change-request flow instead.
exports.setupMine = async (req, res) => {
  try {
    const existing = await Proponent.getProponentByUserId(req.user.id);
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_SET_UP",
        message: "Your business profile is already set up. Request changes from your profile page instead.",
      });
    }

    const { business_name, registration_no, tin, address, contact_no } = req.body || {};
    if (!String(business_name || "").trim()) {
      return res.status(400).json({ success: false, message: "Business name is required." });
    }

    const row = await Proponent.createProponent({
      user_id: req.user.id,
      business_name: String(business_name).trim(),
      registration_no: registration_no ? String(registration_no).trim() : null,
      tin: tin ? String(tin).trim() : null,
      address: address ? String(address).trim() : null,
      contact_no: contact_no ? String(contact_no).trim() : null,
      created_by: req.user.id,
    });

    ActivityLog.recordFromReq(req, {
      entityType: "PROPONENT",
      entityId: row.id,
      action: "PROFILE_SETUP_COMPLETED",
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_SELF_SETUP",
      entityType: "proponent",
      entityId: row?.id,
      details: { business_name: row?.business_name },
      req,
    });

    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Setup my proponent profile error:", error);
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
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CHANGE_REQUESTED",
      entityType: "proponent",
      entityId: current.id,
      details: {
        business_name: current?.business_name,
        changes: diffChanges(current, { ...current, ...payload }, Object.keys(payload)),
      },
      req,
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
    const before = await Proponent.getProponentById(request.proponent_id);
    if (Object.keys(patch).length) {
      await Proponent.updateProponent(request.proponent_id, { ...patch, updated_by: req.user?.id ?? null });
    }

    const remarks = String(req.body?.remarks ?? "").trim() || null;
    const reviewed = await ChangeRequest.markReviewed(id, "APPROVED", req.user?.id ?? null, remarks);

    const patchedProponent = await Proponent.getProponentById(request.proponent_id);
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: request.proponent_id,
      entityType: "PROPONENT",
      entityId: request.proponent_id,
      action: "PROFILE_CHANGE_APPROVED",
      meta: { request_id: id, fields: Object.keys(patch) },
      ip: req.ip,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CHANGE_APPROVED",
      entityType: "proponent",
      entityId: request.proponent_id,
      details: { business_name: patchedProponent?.business_name, changes: diffChanges(before, patchedProponent, Object.keys(patch)) },
      req,
    });

    try {
      const proponent = patchedProponent;
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

    const rejectedProponent = await Proponent.getProponentById(request.proponent_id);
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: request.proponent_id,
      entityType: "PROPONENT",
      entityId: request.proponent_id,
      action: "PROFILE_CHANGE_REJECTED",
      meta: remarks ? { request_id: id, remarks } : { request_id: id },
      ip: req.ip,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CHANGE_REJECTED",
      entityType: "proponent",
      entityId: request.proponent_id,
      details: { business_name: rejectedProponent?.business_name, remarks: remarks || undefined },
      req,
    });

    try {
      const proponent = rejectedProponent;
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
    const {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id,
      stockholders,
      contact_persons,
      signatories,
      is_active,
    } = req.body || {};
    if (!business_name) return res.status(400).json({ success: false, message: "business_name is required" });

    const landUseId = toNullableId(land_use_id);
    const lookupError = await unknownLookup(landUseId, () => LandUse.listLandUses(), "land use");
    if (lookupError) return res.status(400).json({ success: false, message: lookupError });

    const row = await Proponent.createProponent({
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id: landUseId,
      stockholders,
      contact_persons,
      signatories,
      created_by: req.user?.id ?? null,
      is_active,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CREATED",
      entityType: "proponent",
      entityId: row?.id,
      details: { business_name: row?.business_name },
      req,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Section saves for the locator form's Stockholders / Contact Person + Signatory / Property
// schedule tabs — each writes only its own child table(s), independently of the main Save.
function sectionHandler(label, action, run) {
  return async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
      const problem = run.validate(req.body || {});
      if (problem) return res.status(400).json({ success: false, message: problem });
      const data = await run.save(id, req.body || {}, req.user?.id ?? null);
      if (!data) return res.status(404).json({ success: false, message: "Proponent not found" });

      const proponent = await Proponent.getProponentById(id).catch(() => null);
      await AuditLog.record({
        actorId: req.user?.id,
        actorUsername: req.user?.username,
        action,
        entityType: "proponent",
        entityId: id,
        details: { business_name: proponent?.business_name, section: label },
        req,
      });

      return res.json({ success: true, data });
    } catch (error) {
      console.error(`Save ${label} error:`, error);
      // Amount fields that aren't numbers are the caller's mistake, not a server fault.
      const status = /must be a number/.test(error?.message || "") ? 400 : 500;
      return res.status(status).json({ success: false, message: error.message || "Internal server error" });
    }
  };
}

exports.saveStockholders = sectionHandler("stockholders", "PROPONENT_STOCKHOLDERS_UPDATED", {
  validate: (b) => (Array.isArray(b.stockholders) ? null : "stockholders must be a list"),
  save: (id, b, actor) => Proponent.saveStockholders(id, b.stockholders, actor),
});

exports.saveContacts = sectionHandler("contacts", "PROPONENT_CONTACTS_UPDATED", {
  validate: (b) =>
    Array.isArray(b.contact_persons) || Array.isArray(b.signatories) ? null : "contact_persons or signatories must be a list",
  save: (id, b, actor) =>
    Proponent.saveContacts(
      id,
      {
        contact_persons: Array.isArray(b.contact_persons) ? b.contact_persons : undefined,
        signatories: Array.isArray(b.signatories) ? b.signatories : undefined,
      },
      actor
    ),
});

exports.saveProperties = sectionHandler("properties", "PROPONENT_PROPERTIES_UPDATED", {
  validate: (b) => (Array.isArray(b.properties) ? null : "properties must be a list"),
  save: (id, b) => Proponent.saveProperties(id, b.properties),
});

exports.saveInvestment = sectionHandler("investment", "PROPONENT_INVESTMENT_UPDATED", {
  validate: (b) =>
    ["investment_commitment", "investment_actual", "employee_commitment", "employee_actual"].some(
      (k) => b[k] !== undefined
    )
      ? null
      : "at least one investment field is required",
  save: (id, b, actor) =>
    Proponent.saveInvestment(
      id,
      {
        investment_commitment: b.investment_commitment,
        investment_actual: b.investment_actual,
        employee_commitment: b.employee_commitment,
        employee_actual: b.employee_actual,
      },
      actor
    ),
});

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id,
      stockholders,
      contact_persons,
      signatories,
      contract_type_id,
      is_active,
    } = req.body || {};

    // Validate the Type of Contract up front so a bad code can't leave the rest of
    // the edit half-saved.
    const typeId = contract_type_id === null || contract_type_id === undefined || contract_type_id === "" ? null : Number(contract_type_id);
    if (typeId !== null) {
      const known = (await TypeOfContract.listTypeOfContracts()).find((t) => t.id === typeId);
      if (!known) return res.status(400).json({ success: false, message: "Unknown type of contract" });
    }
    // undefined = "not sent, leave alone"; null = "cleared".
    const landUseId = land_use_id === undefined ? undefined : toNullableId(land_use_id);
    const lookupError = await unknownLookup(landUseId, () => LandUse.listLandUses(), "land use");
    if (lookupError) return res.status(400).json({ success: false, message: lookupError });

    const before = await Proponent.getProponentById(id);
    const row = await Proponent.updateProponent(id, {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id: landUseId,
      stockholders,
      contact_persons,
      signatories,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    // Type of Contract lives on the proponent's current contract, not the
    // proponent record — a no-op if there's no contract yet (same as
    // Start/End/Lease Term, it only ever describes one that already exists).
    if (contract_type_id !== undefined) {
      await Contract.setContractTypeForProponent(id, typeId, req.user?.id ?? null);
    }
    const refreshed = await Proponent.getProponentById(id);

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_UPDATED",
      entityType: "proponent",
      entityId: id,
      details: {
        business_name: (refreshed || row)?.business_name,
        changes: diffChanges(before, refreshed, Object.keys(req.body || {})),
      },
      req,
    });

    return res.json({ success: true, data: refreshed || row });
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

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_DEACTIVATED",
      entityType: "proponent",
      entityId: id,
      details: { business_name: row?.business_name },
      req,
    });

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

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_REACTIVATED",
      entityType: "proponent",
      entityId: id,
      details: { business_name: row?.business_name },
      req,
    });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

