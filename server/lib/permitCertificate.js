const crypto = require("crypto");
const { fmtDate, buildCertificateHtml, renderHtmlToPdf, buildQrDataUrl } = require("./certificateRenderer");

// "CONTRACT" is the one permit type that isn't a Compliance Requirement —
// Types entry (see server/models/Permit.js) — everything else's display
// name/title is driven by the configured compliance type's own name
// (typeName, passed in by the caller via ComplianceRequirement.getRequirementByCode) so a
// newly added type just works without a code change here.
const RESERVED_TYPE_LABELS = { CONTRACT: "Lease Contract" };

function permitTypeLabel(type, typeName) {
  if (typeName) return typeName;
  return RESERVED_TYPE_LABELS[String(type || "").toUpperCase()] || String(type || "Permit");
}

function certificateTitle(type, typeName) {
  const label = permitTypeLabel(type, typeName);
  return `CERTIFICATE OF ${label}`.toUpperCase();
}

/** Stable reference numbers derived from the permit itself — no extra DB
 * column, no randomness, so regenerating the certificate (e.g. after an
 * edit) always reproduces the same numbers instead of a new one each time. */
function certificateNo(permit) {
  const year = (permit.issue_date ? new Date(permit.issue_date) : new Date(permit.created_at || Date.now())).getFullYear();
  return `CERT-${year}-${String(permit.id).padStart(5, "0")}`;
}

function verificationCode(permit) {
  const hash = crypto
    .createHash("sha256")
    .update(`${permit.id}:${permit.permit_no}:${permit.created_at || ""}`)
    .digest("hex")
    .toUpperCase();
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

/**
 * Renders a one-page certificate PDF for an issued permit into an in-memory
 * Buffer — called right after a permit is created/updated (see
 * c_permits.js) so every permit gets a real, presentable document instead of
 * relying on staff to source/upload their own scan. HTML+CSS rendered via a
 * headless Chromium (Playwright, see certificateRenderer.js) rather than
 * hand-drawing shapes, so the layout can actually match a real certificate
 * design — and matches the same visual language every other generated
 * certificate (e.g. contracts) uses.
 *
 * No logo/stamp/signature image assets yet — those slots just aren't in the
 * layout rather than showing a broken image; add them to the shared shell
 * once the client supplies real letterhead assets. The QR encodes the
 * reference number itself (plain text, not a URL) since there's no live
 * verification lookup page yet — honest about what scanning it actually
 * gets you, while still matching the requested "scan to verify" layout.
 */
async function renderPermitCertificate({
  permit,
  typeName,
  proponentName,
  proponentAddress,
  applicationNo,
  approvedByName,
  approvedByPosition,
}) {
  const refCode = verificationCode(permit);
  const qrDataUrl = await buildQrDataUrl(refCode);

  const metaRows = [
    { label: "Permit No.", value: permit.permit_no || "—", mono: true },
    { label: "Issuing Authority", value: permit.issuing_authority || "—" },
    { label: "Date Issued", value: fmtDate(permit.issue_date) },
    { label: "Valid Until", value: fmtDate(permit.expiry_date) },
    ...(applicationNo ? [{ label: "Application No.", value: applicationNo, mono: true }] : []),
  ];

  const html = buildCertificateHtml({
    officeLine: "Office of Compliance & Permits — CIAC Locator & Compliance System",
    titleText: certificateTitle(permit.permit_type, typeName),
    certLabel: "CERTIFICATE NO",
    certNo: certificateNo(permit),
    businessName: proponentName,
    businessAddress: proponentAddress,
    statementHtml:
      `has duly complied with and fulfilled the mandatory criteria, documentary requirements, and ` +
      `operational standards for the above permit type, as administered under the applicable ` +
      `compliance rules of this Office, and is hereby granted this ${permitTypeLabel(permit.permit_type, typeName)}.`,
    metaRows,
    refCode,
    qrDataUrl,
    approvedByName,
    approvedByPosition,
    footerNotice:
      "NOTICE: This Certificate remains the official property of the issuing authority. Any alteration, " +
      "erasure, or unauthorized duplication renders this certificate null and void.",
  });

  return renderHtmlToPdf(html);
}

module.exports = { renderPermitCertificate, permitTypeLabel, certificateTitle, certificateNo, verificationCode };
