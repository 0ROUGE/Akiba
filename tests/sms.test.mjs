import test from "node:test";
import assert from "node:assert/strict";
import { toMsisdn, sendSms, smsConfigured } from "../lib/sms.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

const LIVE = { AT_API_KEY: "test-key", AT_USERNAME: "akiba", AT_SENDER_ID: undefined };

function fakeFetch(status, body, spy) {
  return async (url, init) => {
    if (spy) spy.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
}
const recipient = (statusCode, status, extra = {}) => ({
  SMSMessageData: { Message: "Sent to 1/1", Recipients: [{ statusCode, status, number: "+254725455812", messageId: "ATXid_1", ...extra }] },
});

test("toMsisdn normalises every Kenyan mobile shape", () => {
  for (const input of ["0725455812", "+254725455812", "254725455812", "725455812", "+254 725 455 812", "(0725) 455-812"]) {
    assert.equal(toMsisdn(input), "+254725455812", input);
  }
  assert.equal(toMsisdn("0112345678"), "+254112345678");
});

test("toMsisdn rejects junk instead of guessing", () => {
  for (const input of ["", null, undefined, "abc", "12345", "0812345678", "07254558121", "+255725455812", "7254558"]) {
    assert.equal(toMsisdn(input), null, String(input));
  }
});

test("smsConfigured needs both key and username", async () => {
  await withEnv({ AT_API_KEY: "k", AT_USERNAME: undefined }, () => assert.equal(smsConfigured(), false));
  await withEnv({ AT_API_KEY: undefined, AT_USERNAME: "u" }, () => assert.equal(smsConfigured(), false));
  await withEnv({ AT_API_KEY: "k", AT_USERNAME: "u" }, () => assert.equal(smsConfigured(), true));
});

test("sendSms posts the right request to the live endpoint and reports success", async () => {
  await withEnv(LIVE, async () => {
    const spy = [];
    const r = await sendSms("0725455812", "AKIBA: Low balance", { fetchImpl: fakeFetch(201, recipient(101, "Success"), spy) });
    assert.deepEqual(r, { ok: true, messageId: "ATXid_1" });
    assert.equal(spy.length, 1);
    assert.equal(spy[0].url, "https://api.africastalking.com/version1/messaging");
    assert.equal(spy[0].init.headers.apiKey, "test-key");
    const body = new URLSearchParams(spy[0].init.body);
    assert.equal(body.get("username"), "akiba");
    assert.equal(body.get("to"), "+254725455812");
    assert.equal(body.get("message"), "AKIBA: Low balance");
    assert.equal(body.has("from"), false);
  });
});

test("sandbox username uses the sandbox endpoint; sender id is forwarded when set", async () => {
  await withEnv({ AT_API_KEY: "k", AT_USERNAME: "sandbox", AT_SENDER_ID: "AKIBA" }, async () => {
    const spy = [];
    await sendSms("0725455812", "hi", { fetchImpl: fakeFetch(201, recipient(101, "Success"), spy) });
    assert.equal(spy[0].url, "https://api.sandbox.africastalking.com/version1/messaging");
    assert.equal(new URLSearchParams(spy[0].init.body).get("from"), "AKIBA");
  });
});

test("messages are capped at one SMS segment", async () => {
  await withEnv(LIVE, async () => {
    const spy = [];
    await sendSms("0725455812", "x".repeat(400), { fetchImpl: fakeFetch(201, recipient(101, "Success"), spy) });
    assert.equal(new URLSearchParams(spy[0].init.body).get("message").length, 160);
  });
});

test("invalid number / opted-out / unsupported are permanent failures", async () => {
  await withEnv(LIVE, async () => {
    for (const code of [403, 404, 406]) {
      const r = await sendSms("0725455812", "hi", { fetchImpl: fakeFetch(201, recipient(code, "Failed")) });
      assert.equal(r.ok, false);
      assert.equal(r.permanent, true, String(code));
    }
  });
});

test("insufficient AT balance (405) and routing errors are transient", async () => {
  await withEnv(LIVE, async () => {
    for (const code of [405, 407, 500, 501]) {
      const r = await sendSms("0725455812", "hi", { fetchImpl: fakeFetch(201, recipient(code, "Failed")) });
      assert.equal(r.ok, false);
      assert.equal(r.permanent, false, String(code));
    }
  });
});

test("HTTP errors, empty responses and network failures never throw and are transient", async () => {
  await withEnv(LIVE, async () => {
    const http = await sendSms("0725455812", "hi", { fetchImpl: fakeFetch(401, "The supplied authentication is invalid") });
    assert.equal(http.ok, false);
    assert.equal(http.permanent, false);

    const empty = await sendSms("0725455812", "hi", { fetchImpl: fakeFetch(201, { SMSMessageData: { Message: "InvalidSenderId", Recipients: [] } }) });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "InvalidSenderId");

    const garbage = await sendSms("0725455812", "hi", { fetchImpl: fakeFetch(201, "not json") });
    assert.equal(garbage.ok, false);

    const down = await sendSms("0725455812", "hi", {
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    assert.equal(down.ok, false);
    assert.equal(down.permanent, false);
  });
});

test("no network call when unconfigured, or for a bad number / empty message", async () => {
  let calls = 0;
  const spy = async () => {
    calls += 1;
    return { ok: true, status: 201, text: async () => "{}" };
  };
  await withEnv({ AT_API_KEY: undefined, AT_USERNAME: undefined }, async () => {
    const r = await sendSms("0725455812", "hi", { fetchImpl: spy });
    assert.equal(r.notConfigured, true);
    assert.equal(r.permanent, false);
  });
  await withEnv(LIVE, async () => {
    assert.equal((await sendSms("12345", "hi", { fetchImpl: spy })).permanent, true);
    assert.equal((await sendSms("0725455812", "   ", { fetchImpl: spy })).permanent, true);
  });
  assert.equal(calls, 0);
});
