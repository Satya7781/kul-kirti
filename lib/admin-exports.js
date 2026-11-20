/**
 * admin-exports.js — dependency-free CSV / XLSX / PDF generators.
 *
 * Render does not need any extra npm packages for the admin console exports.
 * XLSX is a valid OOXML package (stored, not deflated); PDF uses the standard
 * Helvetica font. Devanagari text is romanised for PDF only because the
 * standard PDF fonts cannot embed Unicode glyphs.
 */
"use strict";

/* ── shared value helpers ───────────────────────────────────────────────── */

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function xmlEscape(value) {
  return cellText(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnLabel(column) {
  return typeof column === "string" ? column : (column.label || column.key);
}

function columnKey(column) {
  return typeof column === "string" ? column : column.key;
}

function rowsToMatrix(columns, rows) {
  return [
    columns.map(columnLabel),
    ...(rows || []).map(row => columns.map(column => {
      const value = row[columnKey(column)];
      if (typeof column === "object" && typeof column.format === "function") {
        return cellText(column.format(value, row));
      }
      return cellText(value);
    })),
  ];
}

/* ── CSV ────────────────────────────────────────────────────────────────── */

function csvCell(value) {
  const text = cellText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns, rows) {
  const matrix = rowsToMatrix(columns, rows);
  return Buffer.from("\uFEFF" + matrix.map(line => line.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");
}

/* ── XLSX (minimal OOXML zip) ───────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of files) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

function excelColumnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function worksheetXml(columns, rows) {
  const matrix = rowsToMatrix(columns, rows);
  const body = matrix.map((line, rowIndex) => {
    const cells = line.map((value, colIndex) => {
      const ref = `${excelColumnName(colIndex)}${rowIndex + 1}`;
      if (rowIndex > 0 && value !== "" && Number.isFinite(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) {
        return `<c r="${ref}"><v>${xmlEscape(value)}</v></c>`;
      }
      return `<c r="${ref}"${rowIndex === 0 ? ' s="1" t="inlineStr"' : ' t="inlineStr"'}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData>${body}</sheetData></worksheet>`;
}

function safeSheetName(name, used) {
  const cleaned = cellText(name).replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "Sheet";
  let candidate = cleaned;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = String(n++);
    candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * @param {Array<{name:string, columns:Array, rows:Array}>} sheets
 * @returns {Buffer} a valid .xlsx workbook
 */
function createXlsx(sheets) {
  const list = Array.isArray(sheets) && sheets.length ? sheets : [{ name: "Report", columns: [], rows: [] }];
  const used = new Set();
  const sheetTags = list.map((_, i) => `<sheet name="${xmlEscape(safeSheetName(list[i].name, used))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const relTags = list.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  const styleRelId = list.length + 1;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheetTags}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTags}` +
    `<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF6B1D2C"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const files = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: styles },
    ...list.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: worksheetXml(sheet.columns || [], sheet.rows || []) })),
  ];
  return zipStore(files);
}

/* ── PDF ────────────────────────────────────────────────────────────────── */

const DEVANAGARI_TO_LATIN = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ii", "उ": "u", "ऊ": "uu", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h", "क्ष": "ksh", "त्र": "tr", "ज्ञ": "gy",
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "्": "", "ं": "n", "ः": "h", "ँ": "n", "्": "", "।": ".", "॥": ".", "०": "0", "१": "1", "२": "2",
  "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

function toLatin(value) {
  return cellText(value)
    .replace(/सिंह/g, "singh")
    .replace(/क्ष|त्र|ज्ञ/g, m => DEVANAGARI_TO_LATIN[m])
    .split("")
    .map(char => {
      if (/[\x20-\x7e]/.test(char)) return char;
      if (DEVANAGARI_TO_LATIN[char] !== undefined) return DEVANAGARI_TO_LATIN[char];
      if (/\s/.test(char)) return " ";
      return "?";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfEscape(value) {
  return toLatin(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(text, maxChars) {
  const words = toLatin(text).split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) { line = word; continue; }
    if ((line + " " + word).length <= maxChars) { line += " " + word; continue; }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function pdfPageStream({ title, subtitle, columns, rows, pageNumber, totalPages }) {
  const commands = [];
  const pageWidth = 842;
  const margin = 36;
  const widths = columns.map(column => {
    const weight = typeof column === "object" && column.width ? Number(column.width) : 1;
    return Math.max(60, Math.floor(((pageWidth - margin * 2) * weight) / columns.reduce((sum, c) => sum + ((typeof c === "object" && c.width) ? Number(c.width) : 1), 0)));
  });

  commands.push("0.42 0.11 0.17 rg");
  commands.push(`${margin} ${560} ${pageWidth - margin * 2} 30 re f`);
  commands.push("BT /F1 15 Tf 1 1 1 rg 46 570 Td (" + pdfEscape(title) + ") Tj ET");
  commands.push("BT /F1 9 Tf 0.35 0.35 0.35 rg 46 548 Td (" + pdfEscape(subtitle || "") + ") Tj ET");

  let y = 520;
  const drawRow = (cells, isHeader) => {
    const wrapped = cells.map((value, i) => wrapText(value, Math.max(6, Math.floor(widths[i] / 5.2))));
    const height = Math.max(...wrapped.map(lines => lines.length)) * 12 + 7;
    if (y - height < 46) return false;
    let x = margin;
    wrapped.forEach((lines, i) => {
      commands.push(`BT /F1 ${isHeader ? 9 : 8} Tf ${isHeader ? "0.42 0.11 0.17" : "0.15 0.15 0.15"} rg ${x + 4} ${y - 12} Td`);
      lines.forEach((line, lineIndex) => {
        commands.push(`${lineIndex === 0 ? "" : "0 -12 Td "}(${pdfEscape(line)}) Tj`);
      });
      commands.push("ET");
      x += widths[i];
    });
    commands.push("0.85 0.85 0.85 RG 0.6 w");
    commands.push(`${margin} ${y - height + 4} m ${pageWidth - margin} ${y - height + 4} l S`);
    y -= height;
    return true;
  };

  drawRow(columns.map(columnLabel), true);
  for (const row of rows) {
    if (!drawRow(columns.map(column => {
      const value = row[columnKey(column)];
      return typeof column === "object" && typeof column.format === "function" ? column.format(value, row) : value;
    }), false)) break;
  }

  commands.push("BT /F1 8 Tf 0.4 0.4 0.4 rg 46 24 Td (Kul-Kirti Admin Console | Page " + pageNumber + " of " + totalPages + ") Tj ET");
  return commands.join("\n");
}

/** @returns {Buffer} a landscape A4 PDF report. */
function createPdf({ title = "Report", subtitle = "", columns = [], rows = [], filename = "" } = {}) {
  const safeColumns = columns.length ? columns : [{ key: "value", label: "Value" }];
  const perPage = 28;
  const chunks = [];
  for (let start = 0; start < Math.max(1, rows.length); start += perPage) chunks.push(rows.slice(start, start + perPage));
  const streams = chunks.map((chunk, i) => pdfPageStream({
    title, subtitle, columns: safeColumns, rows: chunk,
    pageNumber: i + 1, totalPages: chunks.length,
  }));

  const objects = [];
  const pageIds = streams.map((_, i) => 6 + i * 2);
  const contentIds = streams.map((_, i) => 7 + i * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = `<< /Producer (Kul-Kirti Admin Console) /Title (${pdfEscape(title)}) >>`;
  objects[5] = "<< /ProcSet [/PDF /Text] >>";
  streams.forEach((stream, i) => {
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> /ProcSet 5 0 R >> /Contents ${contentIds[i]} 0 R >>`;
    objects[contentIds[i]] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i] || "<< >>"}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/* ── Express response helper ────────────────────────────────────────────── */

function sendExport(response, { filename, format, columns, rows, sheets, title, subtitle }) {
  const ext = String(format || "csv").toLowerCase();
  let buffer;
  let contentType;
  if (ext === "xlsx" || ext === "excel") {
    buffer = createXlsx(sheets || [{ name: title || "Report", columns, rows }]);
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (ext === "pdf") {
    buffer = createPdf({ title, subtitle, columns, rows, filename });
    contentType = "application/pdf";
  } else {
    buffer = toCsv(columns, rows);
    contentType = "text/csv; charset=utf-8";
  }
  response.set("Content-Type", contentType);
  response.set("Content-Disposition", `attachment; filename="${String(filename || "export").replace(/[^a-zA-Z0-9._-]/g, "_")}.${ext === "excel" ? "xlsx" : ext}"`);
  response.set("Cache-Control", "no-store");
  return response.send(buffer);
}

module.exports = {
  toCsv,
  createXlsx,
  createPdf,
  sendExport,
  rowsToMatrix,
  toLatin,
};
