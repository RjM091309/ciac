const crypto = require("crypto");
const { fmtDate, escapeHtml, renderHtmlToPdf, buildQrDataUrl } = require("./certificateRenderer");

/** Stable reference numbers derived from the contract itself — no extra DB
 * column, no randomness, so regenerating the document (e.g. after an edit)
 * always reproduces the same numbers instead of a new one each time. */
function certificateNo(contract) {
  const year = (contract.issue_date ? new Date(contract.issue_date) : new Date(contract.created_at || Date.now())).getFullYear();
  return `LC-${year}-${String(contract.id).padStart(5, "0")}`;
}

function verificationCode(contract) {
  const hash = crypto
    .createHash("sha256")
    .update(`${contract.id}:${contract.contract_no}:${contract.created_at || ""}`)
    .digest("hex")
    .toUpperCase();
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

// A real agreement, not a decorative certificate — plain portrait legal
// document styling (serif body, numbered articles, signature blocks) rather
// than the ornate landscape shell used for permit certificates.
const DOC_STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Times New Roman', Times, serif;
    color: #1a1a1a;
    font-size: 10.8px;
    line-height: 1.4;
  }
  .doc-letterhead { text-align: center; margin-bottom: 4px; }
  .doc-org-name { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 1px; }
  .doc-org-sub { margin: 2px 0 0; font-size: 9px; letter-spacing: 0.4px; color: #555; font-family: Helvetica, Arial, sans-serif; }
  .doc-rule { border: none; border-top: 1.5px solid #1a1a1a; margin: 8px 0 14px; }
  .doc-contract-no { text-align: right; font-size: 10px; color: #444; margin-bottom: 8px; font-family: Helvetica, Arial, sans-serif; }
  .doc-contract-no b { color: #111; }
  .doc-title { text-align: center; font-size: 15px; font-weight: 700; letter-spacing: 1.5px; margin: 0 0 16px; text-decoration: underline; text-underline-offset: 4px; }
  .doc-p { margin: 0 0 9px; text-align: justify; }
  .doc-parties { margin: 0 0 9px; text-align: justify; }
  .doc-party-name { font-weight: 700; }
  .doc-witnesseth { text-align: center; font-weight: 700; letter-spacing: 1px; margin: 13px 0 9px; font-size: 11px; }
  .doc-recital { margin: 0 0 8px; text-align: justify; }
  .doc-article { margin: 10px 0 6px; break-inside: avoid; }
  .doc-article-title { font-weight: 700; letter-spacing: 0.5px; margin: 0 0 4px; font-size: 11px; }
  .doc-clause { margin: 0 0 5px; text-align: justify; padding-left: 4px; }
  .doc-witness-clause { margin: 14px 0 16px; text-align: justify; }
  .doc-sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 32px; margin-top: 6px; break-inside: avoid; }
  .doc-sign-col { text-align: center; }
  .doc-sign-for { text-align: left; font-size: 10px; color: #555; margin-bottom: 20px; font-family: Helvetica, Arial, sans-serif; }
  .doc-sign-line { border-top: 1px solid #1a1a1a; padding-top: 4px; }
  .doc-sign-name { margin: 0; font-weight: 700; font-size: 11px; }
  .doc-sign-pos { margin: 1px 0 0; font-size: 9.5px; color: #555; font-family: Helvetica, Arial, sans-serif; }
  .doc-footer { margin-top: 12px; padding-top: 6px; border-top: 0.5px solid #ccc; display: flex; align-items: center; justify-content: space-between; font-family: Helvetica, Arial, sans-serif; break-inside: avoid; }
  .doc-footer-qr { width: 34px; height: 34px; }
  .doc-footer-text { font-size: 7.5px; color: #9ca3af; text-align: right; line-height: 1.5; }
`;

function buildContractHtml({
  titleText,
  certNo,
  contractNo,
  contractDateLine,
  proponentName,
  proponentAddress,
  representativeName,
  applicationNo,
  typeLabel,
  effectiveStartText,
  effectiveEndText,
  refCode,
  qrDataUrl,
  approvedByName,
  approvedByPosition,
}) {
  const safeBusiness = escapeHtml(proponentName || "—");
  const safeAddress = proponentAddress ? escapeHtml(proponentAddress) : "Clark Freeport Zone, Pampanga, Philippines";
  const safeRep = escapeHtml(representativeName || "Authorized Representative");
  const safeType = escapeHtml(typeLabel);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${DOC_STYLE}</style>
</head>
<body>
  <section class="doc-letterhead">
    <p class="doc-org-name">CLARK DEVELOPMENT CORPORATION</p>
    <p class="doc-org-sub">Clark Freeport Zone, Pampanga, Philippines &bull; Office of Approval &amp; Issuance</p>
  </section>
  <hr class="doc-rule" />

  <div class="doc-contract-no">CONTRACT NO. <b>${escapeHtml(contractNo)}</b> &nbsp;|&nbsp; DOC REF. <b>${escapeHtml(certNo)}</b></div>

  <h1 class="doc-title">${escapeHtml(titleText)}</h1>

  <p class="doc-p">This Agreement ("Agreement") is made and entered into this ${escapeHtml(contractDateLine)}, by and between:</p>

  <p class="doc-parties">
    <span class="doc-party-name">CLARK DEVELOPMENT CORPORATION</span>, a government-owned and controlled corporation duly
    organized and existing under the laws of the Republic of the Philippines, with principal office at Clark Freeport
    Zone, Pampanga, Philippines (hereinafter referred to as the "CORPORATION"),
  </p>
  <p class="doc-parties" style="text-align:center; font-weight:700;">– and –</p>
  <p class="doc-parties">
    <span class="doc-party-name">${safeBusiness}</span>, a duly registered business enterprise with business address at
    ${safeAddress} (hereinafter referred to as the "LOCATOR"),
  </p>
  <p class="doc-p">(the CORPORATION and the LOCATOR are hereinafter collectively referred to as the "Parties").</p>

  <p class="doc-witnesseth">WITNESSETH: THAT</p>

  <p class="doc-recital">
    WHEREAS, the LOCATOR has applied for and been granted approval${applicationNo ? ` under Application No. <b>${escapeHtml(applicationNo)}</b>` : ""}
    to operate its business within the Clark Freeport Zone;
  </p>
  <p class="doc-recital">
    WHEREAS, the CORPORATION, as administrator of the Clark Freeport Zone, has agreed to enter into this ${safeType}
    Agreement with the LOCATOR, subject to the terms and conditions hereinafter set forth;
  </p>
  <p class="doc-recital">
    NOW, THEREFORE, for and in consideration of the foregoing premises and the mutual covenants herein contained,
    the Parties agree as follows:
  </p>

  <div class="doc-article">
    <p class="doc-article-title">ARTICLE I &mdash; SCOPE OF AGREEMENT</p>
    <p class="doc-clause">1.1&nbsp; This Agreement covers the ${safeType} arrangement between the Parties for the LOCATOR's
    business operations within the Clark Freeport Zone, as approved under the application referenced above.</p>
  </div>

  <div class="doc-article">
    <p class="doc-article-title">ARTICLE II &mdash; TERM</p>
    <p class="doc-clause">2.1&nbsp; This Agreement shall take effect on <b>${escapeHtml(effectiveStartText)}</b> and shall
    remain in force until <b>${escapeHtml(effectiveEndText)}</b>, unless sooner terminated in accordance with the
    provisions hereof, or renewed upon mutual written agreement of the Parties.</p>
  </div>

  <div class="doc-article">
    <p class="doc-article-title">ARTICLE III &mdash; OBLIGATIONS OF THE LOCATOR</p>
    <p class="doc-clause">3.1&nbsp; The LOCATOR shall comply with all applicable rules, regulations, and issuances of the
    CORPORATION, including but not limited to environmental, safety, sanitary, and zoning requirements.</p>
    <p class="doc-clause">3.2&nbsp; The LOCATOR shall secure and maintain all necessary permits and clearances required
    for the conduct of its business operations within the Clark Freeport Zone.</p>
    <p class="doc-clause">3.3&nbsp; The LOCATOR shall settle all fees, dues, and other charges as may be prescribed by
    the CORPORATION in a timely manner.</p>
  </div>

  <div class="doc-article">
    <p class="doc-article-title">ARTICLE IV &mdash; COMPLIANCE AND MONITORING</p>
    <p class="doc-clause">4.1&nbsp; The LOCATOR's continued operation within the Clark Freeport Zone shall be subject to
    periodic compliance monitoring and evaluation by the CORPORATION, and to the terms of any permits issued in
    connection with this Agreement.</p>
  </div>

  <div class="doc-article">
    <p class="doc-article-title">ARTICLE V &mdash; TERMINATION</p>
    <p class="doc-clause">5.1&nbsp; This Agreement may be terminated by either Party upon written notice for a material
    breach of any provision hereof that remains uncured, or automatically upon the expiration of the term stated
    in Article II.</p>
  </div>

  <div class="doc-article">
    <p class="doc-article-title">ARTICLE VI &mdash; GOVERNING LAW</p>
    <p class="doc-clause">6.1&nbsp; This Agreement shall be governed by, and construed in accordance with, the laws of
    the Republic of the Philippines.</p>
  </div>

  <p class="doc-witness-clause">
    IN WITNESS WHEREOF, the Parties have caused this Agreement to be executed on the date first above written.
  </p>

  <div class="doc-sign-grid">
    <div class="doc-sign-col">
      <div class="doc-sign-for">For the CORPORATION:</div>
      <div class="doc-sign-line">
        <p class="doc-sign-name">${escapeHtml(approvedByName || "Authorized Signatory")}</p>
        ${approvedByPosition ? `<p class="doc-sign-pos">${escapeHtml(approvedByPosition)}</p>` : ""}
      </div>
    </div>
    <div class="doc-sign-col">
      <div class="doc-sign-for">For the LOCATOR:</div>
      <div class="doc-sign-line">
        <p class="doc-sign-name">${safeRep}</p>
        <p class="doc-sign-pos">${safeBusiness}</p>
      </div>
    </div>
  </div>

  <div class="doc-footer">
    <img src="${qrDataUrl || ""}" class="doc-footer-qr" alt="" />
    <div class="doc-footer-text">
      This document was generated by the 3CORE Portal on ${escapeHtml(fmtDate(new Date()))}.<br/>
      Reference ${escapeHtml(refCode)} &bull; Quote this when inquiring about this document.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Renders the contract as a proper multi-page portrait legal agreement (not
 * a decorative certificate) — parties, recitals, numbered articles, and a
 * dual signature block — into an in-memory Buffer. Called right after a
 * contract is recorded/updated in the Approval Queue's issuance step (see
 * ApprovalIssuance.js's saveContract, wired in c_approvals.js).
 */
async function renderContractCertificate({
  contract,
  proponentName,
  proponentAddress,
  representativeName,
  applicationNo,
  applicationTypeName,
  approvedByName,
  approvedByPosition,
}) {
  const refCode = verificationCode(contract);
  const qrDataUrl = await buildQrDataUrl(refCode);
  const typeLabel = applicationTypeName || "Lease";
  const contractDate = contract.issue_date || contract.created_at || Date.now();

  const html = buildContractHtml({
    titleText: `${typeLabel.toUpperCase()} AGREEMENT`,
    certNo: certificateNo(contract),
    contractNo: contract.contract_no || "—",
    contractDateLine: fmtDate(contractDate),
    proponentName,
    proponentAddress,
    representativeName,
    applicationNo,
    typeLabel,
    effectiveStartText: fmtDate(contract.effective_start),
    effectiveEndText: fmtDate(contract.effective_end),
    refCode,
    qrDataUrl,
    approvedByName,
    approvedByPosition,
  });

  return renderHtmlToPdf(html, { format: "A4", margin: { top: "18mm", bottom: "16mm", left: "20mm", right: "20mm" } });
}

module.exports = { renderContractCertificate, certificateNo, verificationCode };
