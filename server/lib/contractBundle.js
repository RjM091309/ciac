// The contract package Level 2 prints for signing: one PDF with the lease
// agreement, the terms and conditions the locator agreed to, an attachments
// list, and every requirement the locator uploaded (latest file per
// requirement).
//
// The lease agreement is the client's Word template filled with what Level 2
// saved in the Contract tab (lib/leaseAgreement.js), turned into PDF by
// LibreOffice (lib/docxToPdf.js); without LibreOffice a page says to use the
// Word download instead. PDFs are copied page by page and JPG/PNG images get
// a page each; uploaded Word or Excel files are only named in the list.
const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { selectData } = require("../config/database");
const { resolveStoredPath } = require("./fileStorage");
const LeaseAgreement = require("./leaseAgreement");
const { docxToPdf } = require("./docxToPdf");

// Long bond (8.5 × 13 in), the lease agreement's paper.
const PAGE = [612, 936];
const MARGIN = 56;

/** The standard PDF fonts only cover basic Latin: swap the usual extras. */
function plain(text) {
  return String(text || "")
    .replace(/₱/g, "PHP ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\t/g, "    ")
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrap(text, font, size, width) {
  const lines = [];
  for (const paragraph of plain(text).split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the line: hard-break it.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Writes a titled block of text, adding pages as needed. */
function textPages(pdf, fonts, title, body, subtitle) {
  const width = PAGE[0] - MARGIN * 2;
  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  page.drawText(plain(title), { x: MARGIN, y, size: 15, font: fonts.bold });
  y -= 20;
  if (subtitle) {
    page.drawText(plain(subtitle), { x: MARGIN, y, size: 9, font: fonts.regular, color: rgb(0.4, 0.4, 0.45) });
    y -= 22;
  } else {
    y -= 8;
  }
  for (const line of wrap(body, fonts.regular, 10.5, width)) {
    if (y < MARGIN) {
      page = pdf.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
    page.drawText(line, { x: MARGIN, y, size: 10.5, font: fonts.regular });
    y -= 15;
  }
}

async function appendPdf(pdf, bytes) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await pdf.copyPages(src, src.getPageIndices());
  pages.forEach((p) => pdf.addPage(p));
  return pages.length;
}

async function appendImage(pdf, bytes, png) {
  const image = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage(PAGE);
  const maxW = PAGE[0] - MARGIN * 2;
  const maxH = PAGE[1] - MARGIN * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: (PAGE[0] - w) / 2, y: (PAGE[1] - h) / 2, width: w, height: h });
  return 1;
}

function kindOf(bytes) {
  const hex = bytes.subarray(0, 4).toString("hex").toUpperCase();
  if (hex.startsWith("25504446")) return "pdf";
  if (hex.startsWith("FFD8FF")) return "jpg";
  if (hex.startsWith("89504E47")) return "png";
  return null;
}

/**
 * @returns {Promise<{ bytes: Uint8Array, fileName: string } | null>} null when the application has no contract
 */
async function buildContractBundle(applicationId) {
  const appId = Number(applicationId);
  const app = (
    await selectData(
      `SELECT TOP (1) a.id, a.application_no, p.business_name
       FROM dbo.applications a INNER JOIN dbo.proponents p ON p.id = a.proponent_id WHERE a.id = @param0`,
      [appId]
    )
  )?.[0];
  const contract = (
    await selectData(
      `SELECT TOP (1) id, contract_no, effective_start, effective_end FROM dbo.contracts WHERE application_id = @param0`,
      [appId]
    )
  )?.[0];
  if (!app || !contract) return null;
  const terms = (
    await selectData(`SELECT TOP (1) body, version, status, responded_at FROM dbo.application_terms WHERE application_id = @param0`, [appId]).catch(
      () => []
    )
  )?.[0];
  // Latest uploaded file per requirement, in checklist order.
  const docs = await selectData(
    `
    SELECT r.name AS requirement_name, d.original_file_name, d.file_name, d.storage_path
    FROM dbo.application_requirements ar
    INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
    CROSS APPLY (
      SELECT TOP (1) d.* FROM dbo.documents d
      WHERE d.application_id = ar.application_id AND d.requirement_id = ar.requirement_id
      ORDER BY d.id DESC
    ) d
    WHERE ar.application_id = @param0
    ORDER BY r.name
    `,
    [appId]
  );

  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  pdf.setTitle(`Contract ${contract.contract_no} — ${app.business_name}`);

  // 1. The lease agreement.
  let agreementPdf = null;
  try {
    const docx = await LeaseAgreement.current(appId);
    agreementPdf = docx ? await docxToPdf(docx.bytes) : null;
  } catch (error) {
    console.error("Lease agreement PDF error:", error.message || error);
  }
  if (agreementPdf) {
    await appendPdf(pdf, agreementPdf);
  } else {
    textPages(
      pdf,
      fonts,
      `Lease Agreement - ${app.business_name}`,
      `The lease agreement couldn't be added to this PDF (LibreOffice isn't installed on the server).\n\n` +
        `Download it as a Word file from the Contract tab (Lease agreement), print it, and attach it here.`,
      `${app.application_no} - Contract ${contract.contract_no}`
    );
  }

  // 2. The agreed terms.
  if (terms?.body) {
    const agreed = terms.status === "AGREED" && terms.responded_at ? `Agreed by the locator on ${new Date(terms.responded_at).toISOString().slice(0, 10)} (version ${terms.version})` : `Status: ${terms.status}`;
    textPages(pdf, fonts, "Terms and Conditions", terms.body, `${app.business_name} - ${app.application_no}. ${agreed}`);
  }

  // 3. Attachments: index, then the files.
  const included = [];
  const skipped = [];
  const loaded = [];
  for (const d of docs) {
    const abs = resolveStoredPath(d.storage_path);
    const bytes = abs && fs.existsSync(abs) ? fs.readFileSync(abs) : null;
    const kind = bytes ? kindOf(bytes) : null;
    const label = `${d.requirement_name} (${d.original_file_name || d.file_name})`;
    if (!kind) {
      skipped.push(`${label} - ${bytes ? "not a PDF or image, open it in the system" : "file missing"}`);
      continue;
    }
    loaded.push({ label, bytes, kind });
  }
  const index = pdf.getPageCount(); // the attachments list goes here
  for (const item of loaded) {
    try {
      const pages = item.kind === "pdf" ? await appendPdf(pdf, item.bytes) : await appendImage(pdf, item.bytes, item.kind === "png");
      included.push(`${item.label} - ${pages} page${pages === 1 ? "" : "s"}`);
    } catch (error) {
      skipped.push(`${item.label} - could not be read (${error.message})`);
    }
  }
  const list = [
    included.length ? `Included (${included.length}):\n${included.map((l, i) => `${i + 1}. ${l}`).join("\n")}` : "No requirement files to include.",
    skipped.length ? `\nNot included (${skipped.length}):\n${skipped.map((l) => `- ${l}`).join("\n")}` : "",
  ].join("\n");
  // Build the list on a scratch document, then move its pages to the index spot.
  const scratch = await PDFDocument.create();
  textPages(scratch, { regular: await scratch.embedFont(StandardFonts.Helvetica), bold: await scratch.embedFont(StandardFonts.HelveticaBold) }, "Attachments - Locator Requirements", list, `${app.business_name} - ${app.application_no}`);
  const listPages = await pdf.copyPages(scratch, scratch.getPageIndices());
  listPages.forEach((p, i) => pdf.insertPage(index + i, p));

  const safeNo = String(contract.contract_no || appId).replace(/[^A-Za-z0-9-]+/g, "_");
  return { bytes: await pdf.save(), fileName: `Contract-${safeNo}-for-signing.pdf` };
}

module.exports = { buildContractBundle };
