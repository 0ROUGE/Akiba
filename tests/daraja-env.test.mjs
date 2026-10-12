import test from "node:test";
import assert from "node:assert/strict";
import { isProduction, sandboxSimulationEnabled } from "../lib/daraja-env.js";

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

test("sandbox is the default and simulation is on by default there", () => {
  withEnv({ DARAJA_ENV: undefined, SANDBOX_SIMULATE_PAYOUTS: undefined }, () => {
    assert.equal(isProduction(), false);
    assert.equal(sandboxSimulationEnabled(), true);
  });
  withEnv({ DARAJA_ENV: "sandbox", SANDBOX_SIMULATE_PAYOUTS: undefined }, () => {
    assert.equal(sandboxSimulationEnabled(), true);
  });
});

test("simulation can be switched off to try Safaricom's real sandbox B2C", () => {
  withEnv({ DARAJA_ENV: undefined, SANDBOX_SIMULATE_PAYOUTS: "false" }, () => {
    assert.equal(sandboxSimulationEnabled(), false);
  });
});

test("simulation is IMPOSSIBLE in production, whatever else is set", () => {
  for (const flag of [undefined, "true", "false", "1", "yes"]) {
    withEnv({ DARAJA_ENV: "production", SANDBOX_SIMULATE_PAYOUTS: flag }, () => {
      assert.equal(isProduction(), true);
      assert.equal(sandboxSimulationEnabled(), false, String(flag));
    });
  }
});
