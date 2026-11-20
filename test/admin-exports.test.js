"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toCsv, createXlsx, createPdf, toLatin } = require("../lib/admin-exports");

const columns = [
  { key: "name", label: "Name" },
  { key: "count", label: "Count" },
];
const rows = [
  { name: 'Sharma, "Ram"', count: 12 },
  { name: "देवendra सिंह", count: 3 },
];

test("CSV escapes quotes, commas and newlines", () => {
  const csv = toCsv(columns, [{ name: 'a,"b"\nc', count: 1 }]).toString("utf8");
  assert.match(csv, /^\uFEFFName,Count/);
  assert.match(csv, /"a,""b""\nc"/);
});

test("XLSX output is a valid stored ZIP package", () => {
  const book = createXlsx([{ name: "Trees", columns, rows }]);
  assert.equal(book.readUInt32LE(0), 0x04034b50);
  const eocd = book.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0);
  assert.equal(book.readUInt16LE(eocd + 8), 6, "six package parts expected");
  assert.equal(book.readUInt16LE(eocd + 10), 6, "central directory count expected");
  assert.match(book.toString("latin1"), /xl\/worksheets\/sheet1\.xml/);
  assert.match(book.toString("latin1"), /Sharma/);
});

test("PDF output has a catalogue, xref table and trailer", () => {
  const pdf = createPdf({ title: "Admin Report", columns, rows });
  assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const text = pdf.toString("latin1");
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /xref\n0 \d+/);
  assert.match(text, /%%EOF\n$/);
  assert.match(text, /Admin Report/);
});

test("PDF romanises Devanagari because standard fonts cannot embed it", () => {
  assert.equal(toLatin("गेहलोत"), "gehlot");
  assert.equal(toLatin("राम सिंह १२"), "ram singh 12");
});
