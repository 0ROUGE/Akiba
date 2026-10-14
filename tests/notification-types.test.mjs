import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_GROUPS,
  ALL_NOTIFICATION_ITEMS,
  isChannelOn,
  pushAllowed,
} from "../lib/notification-types.js";

const item = (type) => ALL_NOTIFICATION_ITEMS.find((i) => i.type === type);

test("every type appears once", () => {
  const types = ALL_NOTIFICATION_ITEMS.map((i) => i.type);
  assert.equal(new Set(types).size, types.length);
  assert.ok(NOTIFICATION_GROUPS.every((g) => g.items.length > 0));
});

test("SMS-capable types match the database trigger's list exactly", () => {
  // supabase/migrations/20261014_prefs_summary_lockdown.sql: notifications_queue_sms WHEN (...)
  const triggerTypes = ["low_balance", "goal_created", "feature", "monthly_summary"].sort();
  const smsTypes = ALL_NOTIFICATION_ITEMS.filter((i) => i.sms).map((i) => i.type).sort();
  assert.deepEqual(smsTypes, triggerTypes);
});

test("defaults: push on, SMS on for the three alerts, monthly summary SMS off", () => {
  assert.equal(isChannelOn({}, "push", item("deposit_confirmed")), true);
  assert.equal(isChannelOn({}, "sms", item("low_balance")), true);
  assert.equal(isChannelOn({}, "sms", item("goal_created")), true);
  assert.equal(isChannelOn({}, "sms", item("feature")), true);
  assert.equal(isChannelOn({}, "sms", item("monthly_summary")), false);
  assert.equal(isChannelOn(undefined, "sms", item("monthly_summary")), false);
});

test("an explicit boolean wins over the default, in both directions", () => {
  assert.equal(isChannelOn({ sms: { low_balance: false } }, "sms", item("low_balance")), false);
  assert.equal(isChannelOn({ sms: { monthly_summary: true } }, "sms", item("monthly_summary")), true);
  assert.equal(isChannelOn({ push: { deposit_confirmed: false } }, "push", item("deposit_confirmed")), false);
});

test("malformed preference values are ignored, never trusted", () => {
  for (const bad of ["false", "banana", 0, 1, null, [], {}]) {
    assert.equal(isChannelOn({ sms: { low_balance: bad } }, "sms", item("low_balance")), true, String(bad));
    assert.equal(isChannelOn({ push: { deposit_confirmed: bad } }, "push", item("deposit_confirmed")), true, String(bad));
    assert.equal(pushAllowed({ push: { deposit_confirmed: bad } }, "deposit_confirmed"), true, String(bad));
  }
  assert.equal(isChannelOn({ sms: 5, push: "x" }, "sms", item("low_balance")), true);
});

test("pushAllowed honours an explicit opt-out and defaults to on", () => {
  assert.equal(pushAllowed({ push: { auto_save: false } }, "auto_save"), false);
  assert.equal(pushAllowed({ push: { auto_save: true } }, "auto_save"), true);
  assert.equal(pushAllowed({}, "auto_save"), true);
  assert.equal(pushAllowed(null, "anything"), true);
});
