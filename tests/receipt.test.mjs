import test from "node:test";
import assert from "node:assert/strict";
import { buildReceiptPdf, receiptFilename, wrapText, textWidth, toWinAnsi } from "../lib/receipt-pdf.js";
import {
  formatKesAmount, formatReceiptDate, formatPhone, cleanDescription, shouldAnnounceTransaction, receiptRef,
} from "../lib/receipt-format.js";

const TX = {
  id: "9f3c2a17-aaaa-bbbb-cccc-123456789abc",
  type: "deposit",
  amount: 6997,
  created_at: "2026-10-11T10:24:00Z",
  mpesa_receipt_number: "UJBIA9QWBL",
  mpesa_transaction_status: "confirmed",
  description: "M-Pesa deposit",
};
const PROFILE = { full_name: "Christine Keengu", phone: "0725455832" };
const NOW = new Date("2026-10-11T11:00:00Z");
const text = (buf) => buf.toString("latin1");

// Parses the xref table and checks every offset really points at "<n> 0 obj".
function assertValidStructure(buf) {
  const s = text(buf);
  assert.ok(s.startsWith("%PDF-1.4\n"), "header");
  assert.ok(s.endsWith("%%EOF\n"), "trailer");
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), "xref", "startxref points at xref");
  const [, count] = s.slice(startxref).match(/xref\n0 (\d+)\n/);
  const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n \n/g)].map((m) => Number(m[1]));
  assert.equal(entries.length, Number(count) - 1);
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`));
  // /Length of the content stream matches the real stream size
  const m = s.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(Number(m[1]), m[2].length, "stream length");
}

test("receipt PDF is structurally valid and contains the key facts", () => {
  const pdf = buildReceiptPdf({ tx: TX, profile: PROFILE, generatedAt: NOW });
  assertValidStructure(pdf);
  const s = text(pdf);
  for (const expected of ["(AKIBA)", "KES 6,997.00", "Hi CHRISTINE,", "UJBIA9QWBL", "9F3C2A17", "+254 725 455 832", "11th Oct 2026, 1:24 pm", "Total Amount Deposited:", "Your deposit was successful."]) {
    assert.ok(s.includes(expected), `missing: ${expected}`);
  }
  // AKIBA is the first thing drawn (top header) — before the greeting
  assert.ok(s.indexOf("(AKIBA)") < s.indexOf("Hi CHRISTINE"), "AKIBA at the top");
});

test("every transaction type gets the right wording", () => {
  const w = text(buildReceiptPdf({ tx: { ...TX, type: "withdrawal" }, profile: PROFILE, generatedAt: NOW }));
  assert.ok(w.includes("Total Amount Withdrawn:") && w.includes("Your withdrawal was successful."));
  const a = text(buildReceiptPdf({ tx: { ...TX, type: "allocation", mpesa_receipt_number: null }, profile: PROFILE, generatedAt: NOW }));
  assert.ok(a.includes("Total Amount Saved:") && a.includes("(9F3C2A17)"), "falls back to AKIBA ref when there is no M-Pesa number");
  const u = text(buildReceiptPdf({ tx: { ...TX, type: "something_new" }, profile: PROFILE, generatedAt: NOW }));
  assert.ok(u.includes("Your transaction was successful."));
});

test("hostile / odd text can't corrupt the PDF", () => {
  const evil = { ...TX, description: "Fuel (Shell) \\ back\\slash ) ( unbalanced \u2615 \u201Cquoted\u201D \u2014 dash \u0000 nul", };
  const pdf = buildReceiptPdf({ tx: evil, profile: { full_name: "O'Brien (Test) \\ \u4F60\u597D", phone: "x" }, generatedAt: NOW });
  assertValidStructure(pdf);
  const s = text(pdf);
  assert.ok(s.includes("\\(Shell\\)"), "parentheses escaped");
  assert.ok(s.includes("\\\\ back\\\\slash"), "backslashes escaped");
  assert.ok(s.includes("\\) \\( unbalanced"), "unbalanced parens escaped");
  assert.ok(!/[\u0100-\uFFFF]/.test(s), "only latin1 characters in the file");
  assert.ok(s.includes('"quoted" - dash'), "typographic characters mapped");
  assert.equal(toWinAnsi("a\tb\nc"), "a b c");
});

test("missing profile / phone / description still produce a valid receipt", () => {
  for (const profile of [null, undefined, {}, { full_name: "", phone: null }]) {
    const pdf = buildReceiptPdf({ tx: { ...TX, description: null }, profile, generatedAt: NOW });
    assertValidStructure(pdf);
    assert.ok(text(pdf).includes("(Hello,)"));
  }
});

test("very long unbroken text wraps instead of overflowing", () => {
  const long = "x".repeat(400);
  const lines = wrapText(long, 200, 11);
  assert.ok(lines.length > 1);
  lines.forEach((l) => assert.ok(textWidth(l, 11) <= 200 + 0.01, "line within width"));
  assertValidStructure(buildReceiptPdf({ tx: { ...TX, description: long }, profile: PROFILE, generatedAt: NOW }));
  assert.deepEqual(wrapText("", 100, 11), [""]);
});

test("filename + ref", () => {
  assert.equal(receiptFilename(TX), "akiba-receipt-9F3C2A17.pdf");
  assert.equal(receiptRef(undefined), "");
});

test("formatters", () => {
  assert.equal(formatKesAmount(6997), "KES 6,997.00");
  assert.equal(formatKesAmount("1234567.5"), "KES 1,234,567.50");
  assert.equal(formatKesAmount(0.5), "KES 0.50");
  assert.equal(formatKesAmount("abc"), "KES 0.00");
  assert.equal(formatReceiptDate("2026-10-11T10:24:00Z"), "11th Oct 2026, 1:24 pm");
  assert.equal(formatReceiptDate("2026-10-01T21:05:00Z"), "2nd Oct 2026, 12:05 am");
  assert.equal(formatReceiptDate("2026-10-03T09:00:00Z"), "3rd Oct 2026, 12:00 pm");
  assert.equal(formatReceiptDate("2026-10-12T09:00:00Z"), "12th Oct 2026, 12:00 pm");
  assert.equal(formatReceiptDate("2026-10-22T09:00:00Z"), "22nd Oct 2026, 12:00 pm");
  assert.equal(formatReceiptDate("nope"), "");
  assert.equal(formatPhone("0725455832"), "+254 725 455 832");
  assert.equal(formatPhone("+254725455832"), "+254 725 455 832");
  assert.equal(formatPhone("12345"), "");
  assert.equal(formatPhone(null), "");
});

test("cleanDescription removes raw ids", () => {
  const id = "8f1e3d2c-0000-4444-8888-abcdefabcdef";
  assert.equal(cleanDescription(`Allocated to savings goal ${id}`), "Allocated to a savings goal");
  assert.equal(cleanDescription(`Moved ${id} (Laptop)`), "Moved (Laptop)");
  assert.equal(cleanDescription("M-Pesa deposit"), "M-Pesa deposit");
  assert.equal(cleanDescription(null), "");
});

test("shouldAnnounceTransaction: only fresh, confirmed, user-initiated movements, once", () => {
  const now = Date.parse("2026-10-11T11:00:00Z");
  const row = { id: "a", type: "deposit", mpesa_transaction_status: "confirmed", description: "M-Pesa deposit", created_at: "2026-10-11T10:59:00Z" };
  assert.equal(shouldAnnounceTransaction(row, [], now), true);
  assert.equal(shouldAnnounceTransaction({ ...row, type: "withdrawal" }, [], now), true);
  assert.equal(shouldAnnounceTransaction({ ...row, type: "allocation" }, [], now), true);
  assert.equal(shouldAnnounceTransaction({ ...row, mpesa_transaction_status: "pending" }, [], now), false, "pending is not success");
  assert.equal(shouldAnnounceTransaction({ ...row, mpesa_transaction_status: "failed" }, [], now), false);
  assert.equal(shouldAnnounceTransaction({ ...row, type: "spend" }, [], now), false);
  assert.equal(shouldAnnounceTransaction({ ...row, type: "allocation", description: "Auto-save to Phone" }, [], now), false, "auto-saves are silent");
  assert.equal(shouldAnnounceTransaction(row, ["a"], now), false, "already shown");
  assert.equal(shouldAnnounceTransaction({ ...row, created_at: "2026-10-11T10:00:00Z" }, [], now), false, "too old");
  assert.equal(shouldAnnounceTransaction({ ...row, created_at: "2026-10-11T12:00:00Z" }, [], now), false, "from the future");
  assert.equal(shouldAnnounceTransaction({ ...row, created_at: "garbage" }, [], now), false);
  assert.equal(shouldAnnounceTransaction({ ...row, id: null }, [], now), false);
  assert.equal(shouldAnnounceTransaction(null, [], now), false);
});
