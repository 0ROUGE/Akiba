import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { signToken, verifyToken } from "../lib/signed-cookie.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

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
const ENV = { AKIBA_COOKIE_SECRET: "unit-test-secret", TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
const USER = "9825897c-22f2-4860-adf7-640d15a5251a";
const OTHER = "76a44b29-60f6-4425-a5a7-8efb01927549";

test("a freshly signed token verifies for the same user and scope", async () => {
  await withEnv(ENV, async () => {
    const token = await signToken("2fa", USER, 60_000);
    assert.equal(await verifyToken("2fa", token, USER), true);
  });
});

test("it is bound to the user and to the scope", async () => {
  await withEnv(ENV, async () => {
    const token = await signToken("2fa", USER, 60_000);
    assert.equal(await verifyToken("2fa", token, OTHER), false);
    assert.equal(await verifyToken("stepup", token, USER), false);
  });
});

test("expired tokens are rejected", async () => {
  await withEnv(ENV, async () => {
    const token = await signToken("2fa", USER, -1000);
    assert.equal(await verifyToken("2fa", token, USER), false);
  });
});

test("tampering with the signature or expiry is rejected", async () => {
  await withEnv(ENV, async () => {
    const [sub, exp, sig] = (await signToken("2fa", USER, 60_000)).split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    assert.equal(await verifyToken("2fa", `${sub}.${exp}.${flipped}`, USER), false);
    assert.equal(await verifyToken("2fa", `${sub}.${Number(exp) + 86_400_000}.${sig}`, USER), false);
  });
});

test("the old forgeable cookie (just the user id) and other junk are rejected", async () => {
  await withEnv(ENV, async () => {
    for (const junk of [USER, "", null, undefined, "a.b", "a.b.c.d", `${USER}.123.abc`, 42, {}]) {
      assert.equal(await verifyToken("2fa", junk, USER), false, String(junk));
    }
  });
});

test("a token signed with a different secret is rejected", async () => {
  const token = await withEnv(ENV, () => signToken("2fa", USER, 60_000));
  await withEnv({ ...ENV, AKIBA_COOKIE_SECRET: "another-secret" }, async () => {
    assert.equal(await verifyToken("2fa", token, USER), false);
  });
});

test("with no secret configured nothing verifies and nothing can be minted", async () => {
  const token = await withEnv(ENV, () => signToken("2fa", USER, 60_000));
  await withEnv({ AKIBA_COOKIE_SECRET: undefined, TOTP_ENCRYPTION_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    assert.equal(await verifyToken("2fa", token, USER), false);
    await assert.rejects(signToken("2fa", USER, 60_000));
  });
});
