import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithdrawalError, describeStepUpFailure, phoneHoldUntil, parseWholeAmount } from "../lib/api-errors.js";

test("maps every business-rule error start_withdrawal() can raise", () => {
  assert.equal(mapWithdrawalError("ERR_INSUFFICIENT").error, "insufficient");
  assert.equal(mapWithdrawalError("ERR_NO_PHONE").error, "no_phone");
  assert.equal(mapWithdrawalError("ERR_AMOUNT").error, "invalid_amount");
  const hold = mapWithdrawalError("ERR_PHONE_HOLD:2026-10-11T08:00:00Z");
  assert.deepEqual([hold.status, hold.error, hold.releasesAt], [423, "phone_hold", "2026-10-11T08:00:00Z"]);
  const lim = mapWithdrawalError("ERR_DAILY_LIMIT:1500");
  assert.deepEqual([lim.error, lim.remaining], ["daily_limit", 1500]);
  assert.match(lim.message, /KES 1,500/);
  assert.match(mapWithdrawalError("ERR_DAILY_LIMIT:0").message, /reached your daily/);
});

test("unknown database errors are NOT swallowed into a friendly message", () => {
  assert.equal(mapWithdrawalError("deadlock detected"), null);
  assert.equal(mapWithdrawalError(""), null);
  assert.equal(mapWithdrawalError(undefined), null);
});

test("step-up failures: wrong pin counts down, then says locked", () => {
  assert.match(describeStepUpFailure({ error: "pin_wrong", attemptsLeft: 3 }).message, /3 attempts left/);
  assert.match(describeStepUpFailure({ error: "pin_wrong", attemptsLeft: 1 }).message, /1 attempt left/);
  assert.match(describeStepUpFailure({ error: "pin_wrong", attemptsLeft: 0 }).message, /Too many attempts/);
  const locked = describeStepUpFailure({ error: "pin_locked", lockedUntil: "2099-01-01T00:00:00Z" });
  assert.deepEqual([locked.status, locked.lockedUntil], [423, "2099-01-01T00:00:00Z"]);
  assert.equal(describeStepUpFailure({ error: "pin_not_set" }).status, 428);
});

test("a message never reveals the PIN or the stored hash", () => {
  const out = JSON.stringify(describeStepUpFailure({ error: "pin_wrong", attemptsLeft: 2, pin: "482916", hash: "scrypt$x" }));
  assert.equal(out.includes("482916"), false);
  assert.equal(out.includes("scrypt"), false);
});

test("phone hold: active inside 24h, lifted after, null when never changed", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(phoneHoldUntil(null, now), null);
  assert.equal(phoneHoldUntil("2026-10-10T11:00:00Z", now), "2026-10-11T11:00:00.000Z");
  assert.equal(phoneHoldUntil("2026-10-09T11:59:59Z", now), null);
});

test("amounts: whole shillings only, bounded, no strings that sneak through", () => {
  assert.equal(parseWholeAmount(500), 500);
  assert.equal(parseWholeAmount("500"), 500);
  for (const bad of [0, -5, 1.5, "1.5", "", " ", "abc", NaN, Infinity, null, undefined, 1_000_001, "1e9", [], {}]) {
    assert.equal(parseWholeAmount(bad), null, String(bad));
  }
});
