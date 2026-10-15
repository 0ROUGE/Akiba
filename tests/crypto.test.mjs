import test from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncryptionConfigError } from "../lib/crypto.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const SECRET = "JBSWY3DPEHPK3PXP";
const PRIMARY = { TOTP_ENCRYPTION_KEY: "dedicated-key", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" };
const FALLBACK_ONLY = { TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: "service-role-key" };

test("round-trips with the dedicated key and is randomised", () => {
  withEnv(PRIMARY, () => {
    const a = encryptSecret(SECRET);
    const b = encryptSecret(SECRET);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), SECRET);
    assert.ok(!a.includes(SECRET));
  });
});

test("works with only the service-role fallback (the setup page used to fail here)", () => {
  withEnv(FALLBACK_ONLY, () => {
    assert.equal(decryptSecret(encryptSecret(SECRET)), SECRET);
  });
});

test("secrets made under the fallback still decrypt after the dedicated key is added", () => {
  const stored = withEnv(FALLBACK_ONLY, () => encryptSecret(SECRET));
  withEnv(PRIMARY, () => assert.equal(decryptSecret(stored), SECRET));
});

test("secrets made under the dedicated key decrypt if it is later removed", () => {
  const stored = withEnv(PRIMARY, () => encryptSecret(SECRET));
  withEnv({ TOTP_ENCRYPTION_KEY: "dedicated-key", SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    assert.equal(decryptSecret(stored), SECRET);
  });
});

test("the wrong keys cannot decrypt, and tampering is detected", () => {
  const stored = withEnv(PRIMARY, () => encryptSecret(SECRET));
  withEnv({ TOTP_ENCRYPTION_KEY: "someone-elses-key", SUPABASE_SERVICE_ROLE_KEY: "other" }, () => {
    assert.throws(() => decryptSecret(stored));
  });
  withEnv(PRIMARY, () => {
    const buf = Buffer.from(stored, "base64");
    buf[buf.length - 1] ^= 1;
    assert.throws(() => decryptSecret(buf.toString("base64")));
  });
});

test("with no key at all it refuses with a recognisable configuration error", () => {
  withEnv({ TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    let err;
    try {
      encryptSecret(SECRET);
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(isEncryptionConfigError(err), true);
    assert.equal(isEncryptionConfigError(new Error("boom")), false);
    assert.equal(isEncryptionConfigError(null), false);
  });
});
