// Fills a Word (.docx) template by swapping text inside its paragraphs.
//
// Word splits a sentence into runs wherever the formatting (or just the edit
// history) changes, so "{{LESSEE_NAME}}" may be spread over several <w:t>
// nodes. Each replacement is written into the run where the match starts —
// keeping that run's font, size and bold — and the matched characters are
// cut from the runs after it. Nothing else in the file is touched: page
// size, margins, styles, headers and footers stay exactly as in the template.
const JSZip = require("jszip");

const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

function decode(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encode(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Replaces every `find` with `value` in one paragraph's XML. */
function replaceInParagraph(xml, pairs) {
  const re = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>|<w:t(\s[^>]*)?\/>/g;
  const nodes = [];
  let m;
  while ((m = re.exec(xml))) {
    nodes.push({ start: m.index, end: m.index + m[0].length, text: m[2] === undefined ? "" : decode(m[2]) });
  }
  if (!nodes.length) return xml;
  let changed = false;
  for (const [find, value] of pairs) {
    if (!find) continue;
    for (;;) {
      const full = nodes.map((n) => n.text).join("");
      const at = full.indexOf(find);
      if (at < 0) break;
      changed = true;
      // Locate the nodes holding [at, at + find.length).
      let pos = 0;
      let first = -1;
      let remaining = find.length;
      for (let i = 0; i < nodes.length && remaining > 0; i += 1) {
        const n = nodes[i];
        const from = pos;
        const to = pos + n.text.length;
        pos = to;
        if (to <= at) continue;
        const cutStart = Math.max(at - from, 0);
        const cutLen = Math.min(n.text.length - cutStart, remaining);
        if (first < 0) {
          first = i;
          n.text = n.text.slice(0, cutStart) + value + n.text.slice(cutStart + cutLen);
          // Skip past the inserted value so it can't match again.
          remaining -= cutLen;
          if (remaining > 0) continue;
        } else {
          n.text = n.text.slice(0, cutStart) + n.text.slice(cutStart + cutLen);
          remaining -= cutLen;
        }
      }
      if (value.includes(find)) break; // a value containing its own key
    }
  }
  if (!changed) return xml;
  let out = "";
  let last = 0;
  for (const n of nodes) {
    out += xml.slice(last, n.start);
    out += `<w:t xml:space="preserve">${encode(n.text)}</w:t>`;
    last = n.end;
  }
  return out + xml.slice(last);
}

function paragraphText(p) {
  return decode((p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
}

/** `drop`: a paragraph holding one of these is removed, with the empty
 * paragraph (blank line) right after it. */
function replaceInXml(xml, pairs, drop = []) {
  let dropNextBlank = false;
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => {
    const text = drop.length || dropNextBlank ? paragraphText(p) : "";
    if (dropNextBlank) {
      dropNextBlank = false;
      if (!text.trim()) return "";
    }
    if (drop.some((marker) => text.includes(marker))) {
      dropNextBlank = true;
      return "";
    }
    return replaceInParagraph(p, pairs);
  });
}

/**
 * @param {Buffer} template  the .docx bytes
 * @param {Record<string, string> | [string, string][]} replacements  text → new text (in order)
 * @param {{ drop?: string[] }} [options]  paragraphs to remove (see replaceInXml)
 * @returns {Promise<Buffer>}
 */
async function fillDocx(template, replacements, { drop = [] } = {}) {
  const pairs = Array.isArray(replacements) ? replacements : Object.entries(replacements);
  const zip = await JSZip.loadAsync(template);
  for (const name of Object.keys(zip.files)) {
    if (!PARTS.test(name)) continue;
    const xml = await zip.file(name).async("string");
    zip.file(name, replaceInXml(xml, pairs.map(([k, v]) => [String(k), String(v ?? "")]), drop));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Plain text of the document body, one paragraph per line (for checks). */
async function docxText(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(paragraphText).join("\n");
}

module.exports = { fillDocx, docxText, replaceInParagraph };
