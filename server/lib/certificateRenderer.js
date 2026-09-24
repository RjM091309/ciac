const QRCode = require("qrcode");
const { chromium } = require("playwright");

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Shared visual language for every generated certificate (permits, contracts,
// ...) — one CSS block so they all look like they came from the same office,
// and a future new document type is just a new content builder away instead
// of a whole new stylesheet.
const CERT_STYLE = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1f2937;
    background: #ffffff;
  }
  .cert-sheet {
    width: 297mm;
    height: 210mm;
    padding: 5mm;
    background: #fdfcf8;
  }
  .cert-outer-border { height: 100%; border: 2.5px solid #14213d; padding: 4px; }
  .cert-middle-border { height: 100%; border: 1px solid #c9a227; padding: 5px; }
  .cert-inner-frame {
    height: 100%;
    border: 0.75px solid #14213d;
    padding: 26px 48px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .cert-header { text-align: center; }
  .cert-org-name { margin: 0; font-size: 20px; letter-spacing: 2px; font-weight: 700; color: #14213d; }
  .cert-office-name {
    margin: 3px 0 0; font-size: 12px; letter-spacing: 0.5px; color: #4b5563;
    font-family: 'Helvetica', Arial, sans-serif;
  }
  .cert-divider { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 12px auto 0; width: 60%; }
  .cert-divider-line { flex: 1; height: 1px; background: #c9a227; }
  .cert-divider-diamond { width: 8px; height: 8px; background: #c9a227; transform: rotate(45deg); flex-shrink: 0; }
  .cert-title-section { text-align: center; margin-top: 18px; }
  .cert-main-title { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: 1px; color: #14213d; }
  .cert-title-underline { width: 110px; height: 2px; background: #c9a227; margin: 10px auto 0; }
  .cert-number-badge {
    margin-top: 8px; font-family: 'Helvetica', Arial, sans-serif; font-size: 12px; color: #6b7280; letter-spacing: 0.5px;
  }
  .cert-number-value { font-weight: 700; color: #374151; }
  .cert-body-section { text-align: center; margin-top: 18px; }
  .cert-preamble {
    margin: 0; font-size: 13px; font-style: italic; color: #4b5563; font-family: 'Helvetica', Arial, sans-serif;
  }
  .cert-business-box { margin-top: 8px; }
  .cert-business-name { margin: 0; font-size: 26px; font-weight: 700; color: #14213d; }
  .cert-business-address {
    margin: 4px 0 0; font-size: 12px; color: #4b5563; font-family: 'Helvetica', Arial, sans-serif;
  }
  .cert-statement-text {
    margin: 14px auto 0; max-width: 620px; font-size: 12px; line-height: 1.6; color: #374151;
    font-family: 'Helvetica', Arial, sans-serif;
  }
  .cert-meta-grid {
    margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 40px;
    max-width: 520px; margin-left: auto; margin-right: auto; text-align: left;
    font-family: 'Helvetica', Arial, sans-serif;
  }
  .cert-meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; font-weight: 700; }
  .cert-meta-value { font-size: 13px; color: #14213d; font-weight: 700; margin-top: 2px; }
  .cert-meta-mono { font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
  .cert-bottom-section { margin-top: 24px; padding-top: 12px; display: flex; align-items: flex-end; justify-content: space-between; }
  .cert-qr-area { display: flex; align-items: center; gap: 14px; }
  .cert-qr-box { width: 88px; height: 88px; border: 1px solid #e5e7eb; padding: 4px; background: #fff; }
  .cert-qr-img { width: 100%; height: 100%; display: block; }
  .cert-qr-details { display: flex; flex-direction: column; font-family: 'Helvetica', Arial, sans-serif; }
  .cert-qr-title { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #14213d; }
  .cert-qr-subtext { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .cert-qr-code-txt { font-size: 10px; color: #374151; font-family: 'Courier New', monospace; margin-top: 2px; }
  .cert-signatory-area { text-align: center; width: 250px; }
  .cert-signatory-line { border-top: 0.75px solid #6b7280; width: 100%; margin-bottom: 6px; }
  .cert-signatory-name { margin: 0; font-size: 14px; font-weight: 700; color: #14213d; }
  .cert-signatory-pos { margin: 2px 0 0; font-size: 11px; color: #4b5563; font-family: 'Helvetica', Arial, sans-serif; }
  .cert-footer-section {
    margin-top: 12px; padding-top: 8px; border-top: 0.5px solid #e5e7eb; text-align: center;
    font-family: 'Helvetica', Arial, sans-serif;
  }
  .cert-footer-notice {
    margin: 0; font-size: 8.5px; line-height: 1.5; color: #6b7280; max-width: 640px; margin-left: auto; margin-right: auto;
  }
  .cert-footer-hash { margin-top: 4px; font-size: 9px; letter-spacing: 1px; color: #b8901a; font-family: 'Courier New', monospace; }
`;

/** Assembles one certificate's full HTML around the shared CSS shell.
 * `metaRows` is an array of `{ label, value, mono }`; `statementHtml` is
 * pre-escaped/pre-built HTML for the body paragraph (already-safe markup,
 * since callers sometimes bold a word or two inside it). */
function buildCertificateHtml({
  officeLine,
  titleText,
  certLabel,
  certNo,
  businessName,
  businessAddress,
  statementHtml,
  metaRows,
  refCode,
  qrDataUrl,
  approvedByName,
  approvedByPosition,
  footerNotice,
}) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${CERT_STYLE}</style>
</head>
<body>
  <article class="cert-sheet">
    <div class="cert-outer-border">
      <div class="cert-middle-border">
        <div class="cert-inner-frame">
          <header class="cert-header">
            <h2 class="cert-org-name">CLARK DEVELOPMENT CORPORATION</h2>
            <p class="cert-office-name">${escapeHtml(officeLine)}</p>
            <div class="cert-divider">
              <div class="cert-divider-line"></div>
              <div class="cert-divider-diamond"></div>
              <div class="cert-divider-line"></div>
            </div>
          </header>

          <section class="cert-title-section">
            <h1 class="cert-main-title">${escapeHtml(titleText)}</h1>
            <div class="cert-title-underline"></div>
            <div class="cert-number-badge">
              ${escapeHtml(certLabel)}: <span class="cert-number-value">${escapeHtml(certNo)}</span>
            </div>
          </section>

          <section class="cert-body-section">
            <p class="cert-preamble">This is to certify that</p>
            <div class="cert-business-box">
              <h3 class="cert-business-name">${escapeHtml(businessName || "—")}</h3>
              ${businessAddress ? `<p class="cert-business-address">${escapeHtml(businessAddress)}</p>` : ""}
            </div>
            <p class="cert-statement-text">${statementHtml}</p>

            <div class="cert-meta-grid">
              ${metaRows
                .map(
                  (row) => `<div class="cert-meta-item">
                <div class="cert-meta-label">${escapeHtml(row.label)}</div>
                <div class="cert-meta-value${row.mono ? " cert-meta-mono" : ""}">${escapeHtml(row.value)}</div>
              </div>`
                )
                .join("")}
              <div class="cert-meta-item">
                <div class="cert-meta-label">Reference No.</div>
                <div class="cert-meta-value cert-meta-mono">${escapeHtml(refCode)}</div>
              </div>
            </div>
          </section>

          <section class="cert-bottom-section">
            <div class="cert-qr-area">
              <div class="cert-qr-box">
                ${qrDataUrl ? `<img src="${qrDataUrl}" class="cert-qr-img" alt="QR" />` : ""}
              </div>
              <div class="cert-qr-details">
                <span class="cert-qr-title">REFERENCE CODE</span>
                <span class="cert-qr-subtext">Quote this when inquiring about this document</span>
                <span class="cert-qr-code-txt">${escapeHtml(refCode)}</span>
              </div>
            </div>

            <div class="cert-signatory-area">
              <div class="cert-signatory-line"></div>
              <h4 class="cert-signatory-name">${escapeHtml(approvedByName || "Authorized Signatory")}</h4>
              ${approvedByPosition ? `<p class="cert-signatory-pos">${escapeHtml(approvedByPosition)}</p>` : ""}
            </div>
          </section>

          <footer class="cert-footer-section">
            <p class="cert-footer-notice">
              ${escapeHtml(footerNotice)}
              Generated by the CIAC Portal on ${escapeHtml(fmtDate(new Date()))}.
            </p>
            <div class="cert-footer-hash">SEC-DOC &bull; ${escapeHtml(refCode)}</div>
          </footer>
        </div>
      </div>
    </div>
  </article>
</body>
</html>`;
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ["--no-sandbox"] });
  }
  return browserPromise;
}

/** Renders arbitrary HTML (built via buildCertificateHtml above) to a
 * landscape A4 PDF Buffer using a shared, lazily-launched headless Chromium
 * instance — reused across every certificate render in this process rather
 * than launching a fresh browser each time. */
/** Landscape single-sheet certificates (default) pass no options. Multi-page
 * portrait documents (e.g. the contract agreement, see contractCertificate.js)
 * pass `{ format: "A4", margin }` so Chromium paginates the content
 * naturally across as many pages as it needs instead of clipping to one
 * fixed-size sheet. */
async function renderHtmlToPdf(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    if (options.format) {
      return await page.pdf({ format: options.format, printBackground: true, margin: options.margin });
    }
    return await page.pdf({ width: "297mm", height: "210mm", printBackground: true });
  } finally {
    await page.close();
  }
}

async function buildQrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 0, scale: 4 }).catch(() => null);
}

module.exports = { fmtDate, escapeHtml, buildCertificateHtml, renderHtmlToPdf, buildQrDataUrl };
