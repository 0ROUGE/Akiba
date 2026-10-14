import test from "node:test";
import assert from "node:assert/strict";
import { classifyStkResult, isAbandonedUnsent, STK_PROMPT_LIVE_MS, TIMEOUT_DESCRIPTION } from "../lib/stk-result.js";

test("paid and still-processing", () => {
  assert.deepEqual(classifyStkResult("0", "ok", 1000), { action: "confirm" });
  assert.deepEqual(classifyStkResult(0, "ok", 1000), { action: "confirm" }, "numeric 0 too");
  assert.deepEqual(classifyStkResult("500.001.1001", "being processed", 999999), { action: "pending" });
});

test("1037 (prompt never answered) is pending while the prompt is live, then FINAL", () => {
  assert.deepEqual(classifyStkResult("1037", "DS timeout", 30_000), { action: "pending" });
  assert.deepEqual(classifyStkResult("1037", "DS timeout", STK_PROMPT_LIVE_MS - 1), { action: "pending" });
  const r = classifyStkResult("1037", "DS timeout", STK_PROMPT_LIVE_MS);
  assert.equal(r.action, "fail");
  assert.equal(r.description, TIMEOUT_DESCRIPTION);
  assert.equal(r.notify, false);
  // the on-screen message mapper keys on "timed out"
  assert.match(r.description, /timed out/i);
});

test("user-caused failures carry friendly, mappable descriptions", () => {
  assert.deepEqual(classifyStkResult("1032", "x", 5000), { action: "fail", description: "Cancelled on phone", notify: false });
  const bal = classifyStkResult("1", "The balance is insufficient for the transaction.", 5000);
  assert.equal(bal.action, "fail");
  assert.match(bal.description, /insufficient/i);
  assert.match(classifyStkResult("2001", "x", 5000).description, /pin/i);
});

test("unknown codes fail with Safaricom's own words, bounded and never empty", () => {
  assert.equal(classifyStkResult("9999", "Some Daraja message", 5000).description, "Some Daraja message");
  assert.equal(classifyStkResult("9999", "", 5000).description, "Deposit failed");
  assert.equal(classifyStkResult("9999", undefined, 5000).description, "Deposit failed");
  assert.equal(classifyStkResult("9999", "x".repeat(500), 5000).description.length, 200);
  // a reply with no result code is not an answer: leave the row alone (never fail a possibly-paid deposit)
  assert.equal(classifyStkResult(undefined, "x", 5000).action, "pending");
  assert.equal(classifyStkResult(null, "x", 5000).action, "pending");
  assert.equal(classifyStkResult("", "x", 5000).action, "pending");
});

test("never confirms anything except the exact code 0", () => {
  for (const code of ["00", "0.0", " 0", "1", "1032", "1037", "2001", "abc", "", undefined, null, 1, false]) {
    assert.notEqual(classifyStkResult(code, "x", 10 ** 9).action, "confirm", `code ${JSON.stringify(code)}`);
  }
});

test("isAbandonedUnsent only flags old rows that never reached Safaricom", () => {
  assert.equal(isAbandonedUnsent(null, 200_000), true);
  assert.equal(isAbandonedUnsent("", 200_000), true);
  assert.equal(isAbandonedUnsent("AKIBA-1234", 200_000), true, "an internal id is not a Safaricom reference");
  assert.equal(isAbandonedUnsent(null, 60_000), false, "young rows may still be mid-request");
  assert.equal(isAbandonedUnsent("ws_CO_123456", 10 ** 9), false, "sent rows are resolved by querying Safaricom, never abandoned");
});
