import test from "node:test";
import assert from "node:assert/strict";
import { shouldLogoutForAway } from "../lib/away.js";

const NOW = 1_000_000_000_000;
const SIGNED_IN = NOW - 10 * 60 * 1000;

test("away just under / over the limit", () => {
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NOW - 59_000, signedInAt: SIGNED_IN }), false);
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NOW - 60_000, signedInAt: SIGNED_IN }), false);
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NOW - 60_001, signedInAt: SIGNED_IN }), true);
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NOW - 3_600_000, signedInAt: SIGNED_IN - 7_200_000 }), true);
});

test("stale timestamp from an older session is ignored", () => {
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: SIGNED_IN - 1, signedInAt: SIGNED_IN }), false);
});

test("missing / invalid values never log anyone out", () => {
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: null, signedInAt: SIGNED_IN }), false);
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: 0, signedInAt: SIGNED_IN }), false);
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NaN, signedInAt: SIGNED_IN }), false);
  assert.equal(shouldLogoutForAway({ now: NaN, lastSeen: NOW - 120_000, signedInAt: SIGNED_IN }), false);
});

test("works without signedInAt, and tolerates clock going backwards", () => {
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NOW - 120_000, signedInAt: null }), true);
  assert.equal(shouldLogoutForAway({ now: NOW, lastSeen: NOW + 5_000, signedInAt: SIGNED_IN }), false);
});
