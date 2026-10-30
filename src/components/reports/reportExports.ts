// Excel and PDF files for the Reports page, laid out like CIAC's own
// "Compilation of the Quarterly Approved Investments" (Arial, title and
// agency rows, grey bold header, thin borders, landscape A4). exceljs and
// jsPDF load only when someone exports.
import { getSiteSettings } from '../../lib/siteSettings';
import { downloadBlob } from './reportUtils';

export type Money = { amount: number; currency: string } | null;
export type Cell = string | number | Date | null;

export type XlsxColumn = {
  header: string;
  width: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
};

/** One record of the sheet. A record with several lines (a firm's
 * stockholders) gets one row per line; the columns not in `perLine` are
 * merged down those rows. */
export type XlsxGroup = { lines: Cell[][]; highlight?: boolean };

export type XlsxSheet = {
  name: string;
  /** Under the agency row, e.g. "1st Quarter 2026". */
  subtitle?: string;
  columns: XlsxColumn[];
  groups: XlsxGroup[];
  /** Columns that get one cell per line; every other column is merged down the group. */
  perLine?: number[];
  /** Shown under the table. */
  notes?: string[];
  /** Shown when there are no rows. */
  empty?: string;
};

export function agencyName() {
  return getSiteSettings().branding.org_name.toUpperCase();
}

/** "2026-03-31" → a date-only Excel value (no time-zone shift). */
export function xlDate(ymd: string | null | undefined): Date | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}

/** In millions of pesos, as the template asks; another currency is shown as
 * entered (not converted). */
export function millionsCell(m: Money, text: string | null): Cell {
  if (!m) return text || null;
  if (m.currency !== 'PHP') return `${m.currency} ${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return m.amount / 1_000_000;
}

const FONT = 'Arial';
const HEADER_FILL = 'FFD8D8D8';
const HIGHLIGHT_FILL = 'FFFFF2CC';
const TITLE_ROW = 3;
const AGENCY_ROW = 5;
const HEADER_ROW = 7;

export async function downloadWorkbook(fileName: string, title: string, sheets: XlsxSheet[]) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = getSiteSettings().branding.org_short_name;
  workbook.created = new Date();
  const thin = { style: 'thin' as const };
  const medium = { style: 'medium' as const };

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: HEADER_ROW }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.24, right: 0.24, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
        printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
      },
    });
    const lastCol = spec.columns.length;
    sheet.columns = spec.columns.map((c) => ({ width: c.width }));

    sheet.mergeCells(TITLE_ROW, 1, TITLE_ROW, lastCol);
    const titleCell = sheet.getCell(TITLE_ROW, 1);
    titleCell.value = title;
    titleCell.font = { name: FONT, size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getRow(TITLE_ROW).height = 22;

    const agency = sheet.getCell(AGENCY_ROW, 1);
    agency.value = `AGENCY: ${agencyName()}`;
    agency.font = { name: FONT, size: 12, bold: true };
    if (spec.subtitle) {
      const sub = sheet.getCell(AGENCY_ROW + 1, 1);
      sub.value = spec.subtitle;
      sub.font = { name: FONT, size: 11, bold: true };
    }

    const header = sheet.getRow(HEADER_ROW);
    header.height = 45;
    spec.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: FONT, size: 11, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: medium, bottom: thin, left: i === 0 ? medium : thin, right: i === lastCol - 1 ? medium : thin };
    });

    let r = HEADER_ROW + 1;
    const perLine = new Set(spec.perLine || []);
    if (!spec.groups.length && spec.empty) {
      sheet.mergeCells(r, 1, r, lastCol);
      const cell = sheet.getCell(r, 1);
      cell.value = spec.empty;
      cell.font = { name: FONT, size: 11, italic: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: thin, bottom: thin, left: thin, right: thin };
      sheet.getRow(r).height = 24;
      r += 1;
    }
    for (const group of spec.groups) {
      const n = Math.max(1, group.lines.length);
      // Excel doesn't auto-fit generated rows: size each from its longest
      // wrapped text, split over the group's rows.
      const lines = Math.max(
        1,
        ...spec.columns.map((c, i) => {
          const value = group.lines[0]?.[i];
          // ~0.8 characters of 11 pt Arial per unit of column width.
          return typeof value === 'string' && value ? Math.ceil(value.length / Math.max(1, c.width * 0.8)) : 1;
        })
      );
      const groupHeight = Math.max(n * 20, lines * 15 + 8);
      for (let k = 0; k < n; k++) {
        const row = sheet.getRow(r + k);
        row.height = groupHeight / n;
        spec.columns.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const merged = !perLine.has(i);
          const value = merged ? (k === 0 ? group.lines[0]?.[i] ?? null : null) : group.lines[k]?.[i] ?? null;
          cell.value = value as any;
          cell.font = { name: FONT, size: 11, bold: Boolean(c.bold) };
          cell.alignment = { horizontal: c.align || 'center', vertical: 'middle', wrapText: true };
          cell.border = { top: thin, bottom: thin, left: thin, right: thin };
          if (c.numFmt && typeof value !== 'string') cell.numFmt = c.numFmt;
          if (group.highlight) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HIGHLIGHT_FILL } };
        });
      }
      if (n > 1) spec.columns.forEach((_, i) => !perLine.has(i) && sheet.mergeCells(r, i + 1, r + n - 1, i + 1));
      r += n;
    }
    for (const note of spec.notes || []) {
      r += 1;
      sheet.mergeCells(r, 1, r, lastCol);
      const cell = sheet.getCell(r, 1);
      cell.value = note;
      cell.font = { name: FONT, size: 10, italic: true };
      cell.alignment = { wrapText: true, vertical: 'top' };
      sheet.getRow(r).height = 28;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(fileName, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export type PdfCell = string | { content: string; rowSpan?: number; styles?: Record<string, unknown> };
export type PdfSection = {
  heading?: string;
  columns: string[];
  body: PdfCell[][];
  /** Column widths in mm (landscape A4 has ~277 mm inside the margins). */
  widths?: number[];
  aligns?: ('left' | 'center' | 'right')[];
  notes?: string[];
  empty?: string;
  /** Start this section on a new page. */
  newPage?: boolean;
};

/** jsPDF's built-in Helvetica only has the Windows-1252 characters: "₱" or
 * "→" would print as garbage, so they're spelled out. */
function pdfText(s: string) {
  return s
    .replace(/₱\s?/g, 'PHP ')
    .replace(/→/g, '>')
    .replace(/[^\x00-\xFF–—‘’“”•…]/g, '?');
}

function pdfCell(c: PdfCell): PdfCell {
  return typeof c === 'string' ? pdfText(c) : { ...c, content: pdfText(c.content) };
}

export async function downloadPdf(fileName: string, rawTitle: string, rawSubtitle: string, rawSections: PdfSection[]) {
  const title = pdfText(rawTitle);
  const subtitle = pdfText(rawSubtitle);
  const sections = rawSections.map((s) => ({
    ...s,
    heading: s.heading ? pdfText(s.heading) : s.heading,
    columns: s.columns.map(pdfText),
    body: s.body.map((row) => row.map(pdfCell)),
    notes: s.notes?.map(pdfText),
    empty: s.empty ? pdfText(s.empty) : s.empty,
  }));
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(title, pageWidth / 2, 14, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`AGENCY: ${agencyName()}`, margin, 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(subtitle, margin, 27);
  };
  header();
  let y = 32;
  sections.forEach((s, index) => {
    if (s.newPage && index > 0) {
      doc.addPage();
      header();
      y = 32;
    }
    if (s.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(s.heading, margin, y + 3);
      y += 6;
    }
    const body = s.body.length ? s.body : [[{ content: s.empty || 'No records.', colSpan: s.columns.length, styles: { halign: 'center', fontStyle: 'italic' } } as any]];
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [s.columns],
      body: body as any,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.6, valign: 'middle', lineColor: [120, 120, 120], lineWidth: 0.15, textColor: [20, 20, 20] },
      headStyles: { fillColor: [216, 216, 216], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
      columnStyles: Object.fromEntries(
        s.columns.map((_, i) => [i, { cellWidth: s.widths?.[i] ?? 'auto', halign: s.aligns?.[i] ?? 'center' }])
      ),
    });
    y = (doc as any).lastAutoTable.finalY + 4;
    for (const note of s.notes || []) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(note, pageWidth - margin * 2);
      doc.text(lines, margin, y + 2);
      y += lines.length * 3.5 + 1;
    }
    y += 4;
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(`Generated ${new Date().toLocaleString('en-US')}  ·  Page ${i} of ${pages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
    doc.setTextColor(0);
  }
  doc.save(fileName);
}
