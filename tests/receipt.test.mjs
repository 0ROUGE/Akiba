import test from "node:test";
import assert from "node:assert/strict";
import { buildReceipt, TYPE_LABELS } from "../lib/receipt.js";

const fmt = (n) => `Ksh ${Number(n).toFixed(2)}`;
const base = {
  id: "abbb194a-c2f5-45be-a86e-8887b6fe1219",
  type: "deposit",
  amount: 5,
  mpesa_receipt_number: "SLK1ABCD23",
  mpesa_transaction_status: "confirmed",
  description: "M-Pesa deposit",
  created_at: "2026-10-12T09:30:00Z",
};

test("builds label, amount, filename and text for a deposit", () => {
  const r = buildReceipt(base, fmt);
  assert.equal(r.label, "Deposit");
  assert.equal(r.amount, "Ksh 5.00");
  assert.equal(r.filename, "akiba-receipt-abbb194a.png");
  assert.ok(r.text.startsWith("AKIBA receipt\n"));
  assert.ok(r.text.endsWith("Status: Confirmed"));
  assert.ok(r.text.includes("AKIBA reference: ABBB194A"));
});

test("shows a genuine 10-character M-Pesa code", () => {
  const r = buildReceipt(base, fmt);
  assert.deepEqual(r.rows.find(([k]) => k === "M-Pesa receipt no."), ["M-Pesa receipt no.", "SLK1ABCD23"]);
});

test("never shows an internal id as an M-Pesa receipt number", () => {
  for (const internal of ["ws_CO_12102026093000123456789", "3f2b8c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f", "short", "", null, undefined]) {
    const r = buildReceipt({ ...base, mpesa_receipt_number: internal }, fmt);
    assert.equal(r.rows.some(([k]) => k === "M-Pesa receipt no."), false, String(internal));
  }
});

test("omits description row when empty and labels other types", () => {
  const r = buildReceipt({ ...base, description: null, type: "withdrawal" }, fmt);
  assert.equal(r.label, "Withdrawal");
  assert.equal(r.rows.some(([k]) => k === "Description"), false);
  assert.equal(buildReceipt({ ...base, type: "weird" }, fmt).label, "Transaction");
  assert.equal(TYPE_LABELS.allocation, "Allocation to goal");
});

test("dates are rendered in Nairobi time", () => {
  const r = buildReceipt(base, fmt);
  const date = r.rows.find(([k]) => k === "Date")[1];
  assert.match(date, /12 Oct 2026/);
  assert.match(date, /12:30/); // 09:30Z is 12:30 in Nairobi (UTC+3)
});
