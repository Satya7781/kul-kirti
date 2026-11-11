/**
 * Kul-Kirti CSV Parser & Validator
 * ================================
 * Lightweight CSV parser that handles quoted fields, embedded commas,
 * and embedded newlines within quoted fields.  No external dependencies.
 *
 * Designed for the Vanshawali Excel/CSV import system.
 *
 * Public API:
 *   parseCSV(text)           → { headers, rows }  — raw parse
 *   validateImport(parsed)   → { valid, invalid, summary }  — full validation
 *   generateTemplate()       → string  — CSV template for download
 */

"use strict";

/* ── Expected column order (matches the template) ────────────────────────── */
const EXPECTED_COLUMNS = [
  "external_id",
  "full_name",
  "father_external_id",
  "mother_external_id",
  "village",
  "city",
  "district",
  "state",
  "branch_name",
  "living_status",
];

/* ── 1. CSV PARSER ──────────────────────────────────────────────────────────
   Handles:
   - Quoted fields with embedded commas
   - Quoted fields with embedded newlines
   - Escaped quotes ("")
   - Both \n and \r\n line endings
   - Trailing empty lines */

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (double quote)
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
        i++;
      } else if (char === "\n" || char === "\r") {
        // Handle \r\n
        if (char === "\r" && text[i + 1] === "\n") i++;
        currentRow.push(currentField);
        currentField = "";
        // Only push non-empty rows (skip trailing blank lines)
        if (currentRow.some(f => f.trim() !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Handle last field/row if file doesn't end with newline
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(f => f.trim() !== "")) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  // First row is headers — trim and lowercase
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1);

  // Convert each row to an object keyed by header name
  const parsedRows = dataRows.map((row, index) => {
    const obj = {};
    headers.forEach((header, colIndex) => {
      obj[header] = (row[colIndex] || "").trim();
    });
    obj._rowNumber = index + 2; // +2 because row 1 is headers, row 2 is first data
    return obj;
  });

  return { headers, rows: parsedRows };
}

/* ── 2. VALIDATOR ───────────────────────────────────────────────────────────
   Validates parsed CSV data against the expected schema.
   Returns row-level errors and warnings plus a summary. */

function validateImport(parsed) {
  const errors = [];
  const warnings = [];
  const validRows = [];
  const invalidRows = [];

  // ── Check required columns exist ─────────────────────────────────────────
  const missingColumns = EXPECTED_COLUMNS.filter(
    col => !parsed.headers.includes(col)
  );
  if (missingColumns.length) {
    return {
      valid: false,
      error: `Missing required columns: ${missingColumns.join(", ")}`,
      validRows: [],
      invalidRows: [],
      summary: { total: 0, valid: 0, invalid: 0 },
    };
  }

  // ── Track external IDs for duplicate detection ────────────────────────────
  const externalIds = new Map(); // id → row number
  const peopleMap = new Map();    // external_id → row object (for parent resolution)

  // First pass: collect all external_ids and check for duplicates
  parsed.rows.forEach(row => {
    const eid = row.external_id;
    if (eid) {
      if (externalIds.has(eid)) {
        invalidRows.push({
          ...row,
          errors: [`Duplicate external_id "${eid}" — first seen at row ${externalIds.get(eid)}`],
          warnings: [],
          is_valid: false,
        });
      } else {
        externalIds.set(eid, row._rowNumber);
        peopleMap.set(eid, row);
      }
    }
  });

  // Second pass: validate each row
  parsed.rows.forEach(row => {
    // Skip rows already marked invalid by duplicate detection
    if (invalidRows.some(r => r._rowNumber === row._rowNumber)) return;

    const rowErrors = [];
    const rowWarnings = [];

    // full_name is required
    if (!row.full_name) {
      rowErrors.push("full_name is required");
    }

    // living_status must be valid if provided
    if (row.living_status && !["living", "deceased"].includes(row.living_status.toLowerCase())) {
      rowErrors.push(`living_status must be "living" or "deceased", got "${row.living_status}"`);
    }

    // father_external_id must exist in this import (if provided)
    if (row.father_external_id && !peopleMap.has(row.father_external_id)) {
      rowErrors.push(`father_external_id "${row.father_external_id}" not found in import`);
    }

    // mother_external_id must exist in this import (if provided)
    if (row.mother_external_id && !peopleMap.has(row.mother_external_id)) {
      rowErrors.push(`mother_external_id "${row.mother_external_id}" not found in import`);
    }

    // external_id is required (needed for parent references)
    if (!row.external_id) {
      rowErrors.push("external_id is required");
    }

    // Warning: person has no parents (root person)
    if (!row.father_external_id && !row.mother_external_id) {
      rowWarnings.push("No parents specified — this person will be a tree root");
    }

    if (rowErrors.length) {
      invalidRows.push({
        ...row,
        errors: rowErrors,
        warnings: rowWarnings,
        is_valid: false,
      });
    } else {
      validRows.push({
        ...row,
        errors: [],
        warnings: rowWarnings,
        is_valid: true,
      });
    }
  });

  // Third pass: detect circular parent-child references
  const circularErrors = detectCircularReferences(validRows);
  circularErrors.forEach(err => {
    const row = validRows.find(r => r.external_id === err.external_id);
    if (row) {
      row.errors.push(err.message);
      row.is_valid = false;
      // Move from valid to invalid
      const idx = validRows.indexOf(row);
      if (idx !== -1) {
        validRows.splice(idx, 1);
        invalidRows.push(row);
      }
    }
  });

  return {
    valid: true,
    validRows,
    invalidRows,
    summary: {
      total: parsed.rows.length,
      valid: validRows.length,
      invalid: invalidRows.length,
    },
  };
}

/* ── 3. CIRCULAR REFERENCE DETECTION ───────────────────────────────────────
   Walks the parent chain within the import data to detect cycles.
   Uses iterative DFS with a visited set per starting node. */

function detectCircularReferences(rows) {
  const errors = [];
  const idMap = new Map(rows.map(r => [r.external_id, r]));

  for (const row of rows) {
    const visited = new Set();
    let current = row.external_id;

    while (current) {
      if (visited.has(current)) {
        errors.push({
          external_id: row.external_id,
          message: `Circular parent reference detected: ${current} is its own ancestor`,
        });
        break;
      }
      visited.add(current);
      const person = idMap.get(current);
      if (!person) break;
      // Follow father chain first (most common)
      current = person.father_external_id || person.mother_external_id;
      if (!current) break;
      if (visited.has(current)) {
        errors.push({
          external_id: row.external_id,
          message: `Circular parent reference detected via ${current}`,
        });
        break;
      }
    }
  }

  return errors;
}

/* ── 4. TEMPLATE GENERATOR ───────────────────────────────────────────────── */

function generateTemplate() {
  const header = EXPECTED_COLUMNS.join(",");
  const examples = [
    "P001,Ramesh Singh,,,,Rampura,Bhopal,Bhopal,Madhya Pradesh,Main,living",
    "P002,Mahesh Singh,P001,,,Rampura,Bhopal,Bhopal,Madhya Pradesh,Main,living",
    "P003,Suresh Singh,P001,,,Indore,Indore,Indore,Madhya Pradesh,Main,living",
    "P004,Amit Singh,P002,,,Rampura,Bhopal,Bhopal,Madhya Pradesh,Main,living",
  ];
  return [header, ...examples].join("\n");
}

/* ── EXPORTS ─────────────────────────────────────────────────────────────── */

module.exports = {
  EXPECTED_COLUMNS,
  parseCSV,
  validateImport,
  detectCircularReferences,
  generateTemplate,
};
