import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "../lib/csv.js";
import { summarizeLedger, formatNairobi, dayRangeToIso, directionOf } from "../lib/statement.js";

test("csvCell quoting", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell neutralises spreadsheet formulas in text but never touches real numbers", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell(-500), "-500");
  assert.equal(csvCell(1234.5), "1234.5");
  assert.equal(csvCell(NaN), "");
});

test("toCsv builds header + rows with CRLF", () => {
  const csv = toCsv(
    [{ a: "x", b: 1 }, { a: "=bad", b: -2 }],
    [{ header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }]
  );
  assert.equal(csv, "A,B\r\nx,1\r\n'=bad,-2");
  assert.equal(toCsv([], [{ header: "A", value: () => 1 }]), "A");
  assert.equal(toCsv(null, [{ header: "A", value: () => 1 }]), "A");
});

test("summarizeLedger counts only confirmed rows", () => {
  const rows = [
    { type: "deposit", amount: 1000, mpesa_transaction_status: "confirmed" },
    { type: "deposit", amount: 500, mpesa_transaction_status: "pending" },
    { type: "deposit", amount: 700, mpesa_transaction_status: "failed" },
    { type: "withdrawal", amount: 200.5, mpesa_transaction_status: "confirmed" },
    { type: "allocation", amount: 100, mpesa_transaction_status: "confirmed" },
    { type: "spend", amount: 50, mpesa_transaction_status: "confirmed" },
    { type: "deposit", amount: "bad", mpesa_transaction_status: "confirmed" },
    { type: "deposit", amount: -5, mpesa_transaction_status: "confirmed" },
  ];
  assert.deepEqual(summarizeLedger(rows), { deposits: 1000, withdrawals: 200.5, allocations: 100, spend: 50, count: 4, net: 649.5 });
  assert.deepEqual(summarizeLedger([]), { deposits: 0, withdrawals: 0, allocations: 0, spend: 0, count: 0, net: 0 });
  assert.equal(summarizeLedger(null).net, 0);
});

test("formatNairobi uses East Africa Time (UTC+3)", () => {
  assert.equal(formatNairobi("2026-10-08T11:32:00Z"), "2026-10-08 14:32");
  assert.equal(formatNairobi("2026-10-08T22:30:00Z"), "2026-10-09 01:30");
  assert.equal(formatNairobi("nope"), "");
});

test("dayRangeToIso is inclusive of the end day and rejects bad ranges", () => {
  const r = dayRangeToIso("2026-10-01", "2026-10-01");
  assert.ok(new Date(r.endIso) - new Date(r.startIso) >= 23 * 3600 * 1000);
  assert.equal(dayRangeToIso("2026-10-05", "2026-10-01"), null);
  assert.equal(dayRangeToIso("bad", "2026-10-01"), null);
});

test("directionOf", () => {
  assert.equal(directionOf("deposit"), "In");
  assert.equal(directionOf("withdrawal"), "Out");
  assert.equal(directionOf("allocation"), "Out");
});
