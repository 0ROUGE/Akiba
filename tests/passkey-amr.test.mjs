import test from "node:test";
import assert from "node:assert/strict";
import { freshPasskeyAuth, decodeJwtPayload } from "../lib/passkey-amr.js";

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (payload) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;
const NOW = 1_800_000_000_000; // fixed clock (ms)
const nowSec = NOW / 1000;
const check = (payload, opts = {}) => freshPasskeyAuth(jwt(payload), { nowMs: NOW, ...opts });

test("a passkey sign-in a few seconds ago passes", () => {
  const r = check({ amr: [{ method: "passkey", timestamp: nowSec - 5 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.methods, ["passkey"]);
});

test("webauthn naming and any letter case also count", () => {
  assert.equal(check({ amr: [{ method: "webauthn", timestamp: nowSec - 1 }] }).ok, true);
  assert.equal(check({ amr: [{ method: "Passkey", timestamp: nowSec - 1 }] }).ok, true);
});

test("a password-only session can never pass", () => {
  const r = check({ amr: [{ method: "password", timestamp: nowSec - 1 }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.methods, ["password"]);
});

test("password + TOTP (no passkey) does not pass", () => {
  assert.equal(check({ amr: [{ method: "password", timestamp: nowSec }, { method: "totp", timestamp: nowSec }] }).ok, false);
});

test("an old passkey sign-in (session refreshed later) does not pass", () => {
  assert.equal(check({ amr: [{ method: "passkey", timestamp: nowSec - 121 }] }).ok, false);
  assert.equal(check({ amr: [{ method: "passkey", timestamp: nowSec - 119 }] }).ok, true);
});

test("timestamps from the future are rejected", () => {
  assert.equal(check({ amr: [{ method: "passkey", timestamp: nowSec + 3600 }] }).ok, false);
});

test("bare method names with no timestamp fail closed", () => {
  assert.equal(check({ amr: ["passkey"] }).ok, false);
  assert.equal(check({ amr: [{ method: "passkey" }] }).ok, false);
  assert.equal(check({ amr: [{ method: "passkey", timestamp: "soon" }] }).ok, false);
});

test("garbage tokens and missing claims fail closed without throwing", () => {
  for (const token of [undefined, null, "", "abc", "a.b.c", jwt({}), jwt({ amr: "passkey" }), jwt({ amr: null })]) {
    assert.equal(freshPasskeyAuth(token, { nowMs: NOW }).ok, false, String(token));
  }
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
});
