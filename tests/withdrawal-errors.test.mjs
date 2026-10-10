import test from "node:test";
import assert from "node:assert/strict";
import { describeWithdrawalError } from "../lib/withdrawal-errors.js";

test("maps each database error to a helpful message", () => {
  assert.equal(describeWithdrawalError("ERR_NO_PHONE").code, "no_phone");
  assert.equal(describeWithdrawalError("ERR_INSUFFICIENT").message, "Insufficient AKIBA balance");
  assert.equal(describeWithdrawalError("ERR_AMOUNT").code, "amount");

  const hold = describeWithdrawalError("ERR_PHONE_HOLD:2026-10-10T08:00:00Z");
  assert.equal(hold.code, "phone_hold");
  assert.match(hold.message, /24 hours/);
  assert.match(hold.message, /2026/);

  const limit = describeWithdrawalError("ERR_DAILY_LIMIT:400.00");
  assert.equal(limit.code, "daily_limit");
  assert.match(limit.message, /KES 400/);
  assert.equal(describeWithdrawalError("ERR_DAILY_LIMIT:0.00").message, "You've reached your daily withdrawal limit. Try again later.");
});

test("unknown / empty errors never leak internals", () => {
  const r = describeWithdrawalError('duplicate key value violates unique constraint "x"');
  assert.equal(r.code, "unknown");
  assert.doesNotMatch(r.message, /constraint|duplicate/);
  assert.equal(describeWithdrawalError(undefined).code, "unknown");
  assert.equal(describeWithdrawalError(null).code, "unknown");
});
