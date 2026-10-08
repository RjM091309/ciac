const { selectData } = require("../config/database");

/** Which application-list "bucket" a role's sidebar menu maps to — mirrors
 * how each queue (New Applications, Renewals, Evaluation Queue, Approval
 * Queue) actually filters its own list, so global search only ever surfaces
 * an application through the same door that module's own screen would.
 * A non-renewal application that has reached APPROVED drops off the New
 * Applications list entirely (it's done), so it gets its own bucket
 * pointing at the Locators/Proponent directory instead. */
const BUCKET_MENU_KEYS = {
  in_new: "applications:new",
  in_renewals: "applications:renewals",
  in_assessment: "assessment:queue",
  in_approval: "approval:queue",
  in_completed: "settings:proponents",
};

/** Finds applications by application number, locator Ref No or business name,
 * tagging each row with which queue(s) it would show up in — the caller
 * (c_search.js) keeps only the buckets the requesting role actually has
 * Control Panel sidebar access to. Admins get every bucket, so this never
 * filters rows out for them. Capped at 20 results; DRAFT is excluded (same
 * as every other application list in the app — it's private to the
 * proponent until submitted). */
async function searchApplications(term) {
  const like = `%${String(term || "").trim()}%`;
  return selectData(
    `
    SELECT TOP (20)
      a.id,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      p.id AS proponent_id,
      p.business_name AS proponent_name,
      p.ref_no AS proponent_ref_no,
      CASE WHEN a.is_renewal = 0 AND a.status <> 'APPROVED' THEN 1 ELSE 0 END AS in_new,
      CASE WHEN a.is_renewal = 1 THEN 1 ELSE 0 END AS in_renewals,
      -- Approved and Account Officer assigned → Registered Locator.
      CASE WHEN a.is_renewal = 0 AND a.status = 'APPROVED' AND ISNULL(a.awaiting_ao_assignment, 0) = 0 THEN 1 ELSE 0 END AS in_completed,
      CASE
        WHEN asm.id IS NOT NULL AND asm.stage <> 'COMPLETED' THEN 1
        -- For Approval is decided from the Evaluation Queue (Level 1).
        WHEN a.status = 'FOR_APPROVAL' THEN 1
        WHEN asm.id IS NULL AND a.status IN ('SUBMITTED', 'RESUBMITTED', 'RETURNED') THEN 1
        ELSE 0
      END AS in_assessment,
      -- /approval is the Approved Queue: approved, waiting for an Account
      -- Officer. (For Approval itself is handled in the Evaluation Queue.)
      CASE WHEN ISNULL(a.awaiting_ao_assignment, 0) = 1 THEN 1 ELSE 0 END AS in_approval,
      asm.assigned_evaluator_id AS assessment_evaluator_id
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
    WHERE a.status <> 'DRAFT'
      AND (a.application_no LIKE @param0 OR p.business_name LIKE @param0 OR p.ref_no LIKE @param0)
    ORDER BY a.id DESC
    `,
    [like]
  );
}

module.exports = { BUCKET_MENU_KEYS, searchApplications };
