import test from "node:test";
import assert from "node:assert/strict";
import { validatePinFormat, hashPin, verifyPin } from "../lib/pin.js";

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const ENV = { AKIBA_PIN_PEPPER: "unit-test-pepper", TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
const USER = "9825897c-22f2-4860-adf7-640d15a5251a";
const OTHER = "76a44b29-60f6-4425-a5a7-8efb01927549";

test("accepts sensible 4-6 digit PINs", () => {
  for (const pin of ["2580", "1357", "4093", "159753", "90210", "7391"]) {
    assert.equal(validatePinFormat(pin).ok, true, pin);
  }
});

test("rejects bad length, non-digits and non-strings", () => {
  for (const pin of ["123", "1234567", "12a4", "12 34", "", "+123", null, undefined, 1234, ["1234"]]) {
    assert.equal(validatePinFormat(pin).ok, false, String(pin));
  }
});

test("rejects repeated digits and simple sequences", () => {
  for (const pin of ["0000", "1111", "999999", "1234", "4321", "0123", "6789", "123456", "654321"]) {
    assert.equal(validatePinFormat(pin).ok, false, pin);
  }
});

test("hash round-trips and is salted", async () => {
  await withEnv(ENV, async () => {
    const a = await hashPin(USER, "2580");
    const b = await hashPin(USER, "2580");
    assert.match(a, /^scrypt1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    assert.notEqual(a, b);
    assert.equal(await verifyPin(USER, "2580", a), true);
    assert.equal(await verifyPin(USER, "2580", b), true);
  });
});

test("wrong PIN, other user, or other pepper do not verify", async () => {
  const hash = await withEnv(ENV, () => hashPin(USER, "2580"));
  await withEnv(ENV, async () => {
    assert.equal(await verifyPin(USER, "2581", hash), false);
    assert.equal(await verifyPin(OTHER, "2580", hash), false);
  });
  await withEnv({ ...ENV, AKIBA_PIN_PEPPER: "different-pepper" }, async () => {
    assert.equal(await verifyPin(USER, "2580", hash), false);
  });
});

test("malformed stored hashes fail closed without throwing", async () => {
  await withEnv(ENV, async () => {
    for (const stored of ["", null, undefined, "garbage", "scrypt1$", "scrypt1$zz$zz", "md5$aa$bb", 12345]) {
      assert.equal(await verifyPin(USER, "2580", stored), false, String(stored));
    }
  });
});

test("with no pepper configured hashing refuses and verifying fails closed", async () => {
  const hash = await withEnv(ENV, () => hashPin(USER, "2580"));
  await withEnv({ AKIBA_PIN_PEPPER: undefined, TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    await assert.rejects(hashPin(USER, "2580"));
    assert.equal(await verifyPin(USER, "2580", hash), false);
  });
});
