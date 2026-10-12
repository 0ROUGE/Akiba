import test from "node:test";
import assert from "node:assert/strict";
import { callbackToken, withCallbackToken, isValidCallbackRequest } from "../lib/callback-auth.js";

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
const ENV = { MPESA_CALLBACK_SECRET: "unit-test-secret", TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
const req = (url) => ({ url });

test("token is a stable 64-char hex string", () => {
  withEnv(ENV, () => {
    const t = callbackToken();
    assert.match(t, /^[0-9a-f]{64}$/);
    assert.equal(callbackToken(), t);
  });
});

test("token depends on the secret", () => {
  const a = withEnv(ENV, () => callbackToken());
  const b = withEnv({ ...ENV, MPESA_CALLBACK_SECRET: "another-secret" }, () => callbackToken());
  assert.notEqual(a, b);
});

test("falls back to existing server secrets, and fails closed with none", () => {
  const viaTotp = withEnv({ MPESA_CALLBACK_SECRET: undefined, TOTP_ENCRYPTION_KEY: "k1", SUPABASE_SERVICE_ROLE_KEY: "k2" }, () => callbackToken());
  const viaService = withEnv({ MPESA_CALLBACK_SECRET: undefined, TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: "k2" }, () => callbackToken());
  assert.notEqual(viaTotp, viaService);
  withEnv({ MPESA_CALLBACK_SECRET: undefined, TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    assert.throws(() => callbackToken());
    assert.equal(isValidCallbackRequest(req("https://x.test/cb?k=anything")), false);
  });
});

test("withCallbackToken appends the token as ?k=", () => {
  withEnv(ENV, () => {
    assert.equal(withCallbackToken("https://x.test/api/cb"), `https://x.test/api/cb?k=${callbackToken()}`);
  });
});

test("accepts the real token and rejects everything else", () => {
  withEnv(ENV, () => {
    const good = withCallbackToken("https://x.test/api/cb");
    assert.equal(isValidCallbackRequest(req(good)), true);
    assert.equal(isValidCallbackRequest(req("https://x.test/api/cb")), false);
    assert.equal(isValidCallbackRequest(req("https://x.test/api/cb?k=")), false);
    assert.equal(isValidCallbackRequest(req("https://x.test/api/cb?k=deadbeef")), false);
    assert.equal(isValidCallbackRequest(req(`${good}0`)), false);
    assert.equal(isValidCallbackRequest(req(good.toUpperCase())), false);
    assert.equal(isValidCallbackRequest({}), false);
    assert.equal(isValidCallbackRequest(req("not a url")), false);
  });
});
