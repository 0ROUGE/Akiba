import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TOTP_ENCRYPTION_KEY = "test-key-for-unit-tests-only";
const { validatePinFormat, hashPin, verifyPinHash, checkPin } = await import("../lib/pin.js");

test("accepts ordinary 6-digit PINs", () => {
  for (const pin of ["482916", "070709", "913357", "100234"]) assert.equal(validatePinFormat(pin).ok, true, pin);
});

test("rejects wrong shapes", () => {
  for (const pin of ["12345", "1234567", "12a456", "", "      ", null, undefined, 123456, "12 456"]) {
    assert.equal(validatePinFormat(pin).ok, false, String(pin));
  }
});

test("rejects the PINs attackers try first", () => {
  for (const pin of ["000000", "111111", "123456", "654321", "234567", "012345", "987654", "121212", "123123", "696969".replace("696969", "454545")]) {
    assert.equal(validatePinFormat(pin).ok, false, pin);
    assert.equal(validatePinFormat(pin).reason, "weak", pin);
  }
});

test("hash/verify round trip, and a wrong PIN fails", async () => {
  const h = await hashPin("482916");
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPinHash("482916", h), true);
  assert.equal(await verifyPinHash("482917", h), false);
});

test("two hashes of the same PIN differ (per-user random salt)", async () => {
  assert.notEqual(await hashPin("482916"), await hashPin("482916"));
});

test("hash is bound to the server pepper: a different key can't verify it", async () => {
  const h = await hashPin("482916");
  process.env.TOTP_ENCRYPTION_KEY = "a-completely-different-server-key";
  assert.equal(await verifyPinHash("482916", h), false);
  process.env.TOTP_ENCRYPTION_KEY = "test-key-for-unit-tests-only";
  assert.equal(await verifyPinHash("482916", h), true);
});

test("malformed or tampered stored hashes fail closed instead of throwing", async () => {
  for (const bad of ["", "nonsense", "scrypt$x$y$z$a$b", null, undefined, "bcrypt$1$2$3$4$5"]) {
    assert.equal(await verifyPinHash("482916", bad), false);
  }
  const h = await hashPin("482916");
  const tampered = h.slice(0, -4) + (h.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(await verifyPinHash("482916", tampered), false);
});

// ---- checkPin orchestration against a fake admin client -------------------
function fakeAdmin({ hash, gate = { status: "ok", attempts_left: 4 } }) {
  const calls = [];
  return {
    calls,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: hash ? { pin_hash: hash } : null }) }) }) }),
    rpc: async (name, args) => { calls.push([name, args]); return { data: name === "begin_step_up_attempt" ? gate : null, error: null }; },
  };
}

test("checkPin: malformed PIN is rejected WITHOUT consuming an attempt", async () => {
  const a = fakeAdmin({ hash: await hashPin("482916") });
  const r = await checkPin(a, "u", "12");
  assert.equal(r.error, "pin_invalid_format");
  assert.equal(a.calls.length, 0);
});

test("checkPin: no PIN set -> pin_not_set (428), no attempt consumed", async () => {
  const a = fakeAdmin({ hash: null });
  const r = await checkPin(a, "u", "482916");
  assert.deepEqual([r.ok, r.error, r.status], [false, "pin_not_set", 428]);
  assert.equal(a.calls.length, 0);
});

test("checkPin: locked -> 423 and the PIN is never even compared", async () => {
  const a = fakeAdmin({ hash: await hashPin("482916"), gate: { status: "locked", locked_until: "2099-01-01T00:00:00Z" } });
  const r = await checkPin(a, "u", "482916"); // the CORRECT pin, still refused while locked
  assert.deepEqual([r.ok, r.error, r.status], [false, "pin_locked", 423]);
  assert.equal(a.calls.some(([n]) => n === "reset_step_up_attempts"), false);
});

test("checkPin: wrong PIN -> 403 with attempts left; correct PIN -> ok and resets counter", async () => {
  const hash = await hashPin("482916");
  const wrong = await checkPin(fakeAdmin({ hash, gate: { status: "ok", attempts_left: 3 } }), "u", "111222");
  assert.deepEqual([wrong.ok, wrong.error, wrong.status, wrong.attemptsLeft], [false, "pin_wrong", 403, 3]);

  const a = fakeAdmin({ hash });
  const right = await checkPin(a, "u", "482916");
  assert.equal(right.ok, true);
  assert.deepEqual(a.calls.map(([n]) => n), ["begin_step_up_attempt", "reset_step_up_attempts"]);
});

test("checkPin: attempt is reserved BEFORE comparing (parallel guesses can't beat the lock)", async () => {
  const a = fakeAdmin({ hash: await hashPin("482916") });
  await checkPin(a, "u", "999000");
  assert.equal(a.calls[0][0], "begin_step_up_attempt");
});
