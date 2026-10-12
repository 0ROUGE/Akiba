import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, stkPush, queryStkStatus, __resetTokenCache } from "../lib/mpesa.js";

const ENV = {
  DARAJA_CONSUMER_KEY: "key",
  DARAJA_CONSUMER_SECRET: "secret",
  DARAJA_SHORTCODE: "174379",
  DARAJA_PASSKEY: "passkey",
  DARAJA_ENV: undefined,
};

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

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const TOKEN = reply(200, { access_token: "tok-1", expires_in: "3599" });
const STK_OK = reply(200, { ResponseCode: "0", CheckoutRequestID: "ws_CO_1" });
const stkArgs = {
  phone: "0725455812",
  amount: 5,
  accountReference: "AKIBA-12345678",
  description: "AKIBA deposit",
  callbackUrl: "https://x.test/cb?k=1",
};

async function withFetch(handler, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), calls.length);
  };
  __resetTokenCache();
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
    __resetTokenCache();
  }
}

test("normalizePhone handles every Kenyan format and never throws", () => {
  for (const p of ["0725455812", "+254725455812", "254725455812", "725455812", "+254 725 455 812"]) {
    assert.equal(normalizePhone(p), "254725455812", p);
  }
  assert.equal(normalizePhone("0112345678"), "254112345678");
  assert.equal(normalizePhone(null), "");
  assert.equal(normalizePhone(undefined), "");
});

test("the OAuth token is fetched once and reused", async () => {
  await withEnv(ENV, () =>
    withFetch(
      (url) => (url.includes("/oauth/") ? TOKEN : STK_OK),
      async (calls) => {
        await stkPush(stkArgs);
        await stkPush(stkArgs);
        assert.equal(calls.filter((c) => c.url.includes("/oauth/")).length, 1);
        assert.equal(calls.filter((c) => c.url.includes("/stkpush/")).length, 2);
      }
    )
  );
});

test("an expired token is refreshed and the request retried once", async () => {
  let stkAttempts = 0;
  await withEnv(ENV, () =>
    withFetch(
      (url) => {
        if (url.includes("/oauth/")) return TOKEN;
        stkAttempts += 1;
        return stkAttempts === 1 ? reply(401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" }) : STK_OK;
      },
      async (calls) => {
        const out = await stkPush(stkArgs);
        assert.equal(out.CheckoutRequestID, "ws_CO_1");
        assert.equal(calls.filter((c) => c.url.includes("/oauth/")).length, 2);
      }
    )
  );
});

test("a non-JSON gateway error becomes a readable Error, not a SyntaxError", async () => {
  await withEnv(ENV, () =>
    withFetch(
      (url) => (url.includes("/oauth/") ? TOKEN : reply(502, "<html>Bad Gateway</html>")),
      async () => {
        await assert.rejects(stkPush(stkArgs), (err) => {
          assert.equal(err.name, "Error");
          assert.match(err.message, /HTTP 502/);
          return true;
        });
      }
    )
  );
});

test("network failure and timeouts give friendly messages", async () => {
  await withEnv(ENV, async () => {
    await withFetch(
      () => {
        throw new TypeError("fetch failed");
      },
      async () => {
        await assert.rejects(stkPush(stkArgs), /couldn't reach Safaricom/);
      }
    );
    await withFetch(
      () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
      async () => {
        await assert.rejects(stkPush(stkArgs), /took too long/);
      }
    );
  });
});

test("a rejected STK push (ResponseCode != 0) is an error even on HTTP 200", async () => {
  await withEnv(ENV, () =>
    withFetch(
      (url) => (url.includes("/oauth/") ? TOKEN : reply(200, { ResponseCode: "1", ResponseDescription: "Invalid shortcode" })),
      async () => {
        await assert.rejects(stkPush(stkArgs), /Invalid shortcode/);
      }
    )
  );
});

test("status query: 'still processing' (HTTP 500 / 500.001.1001) is reported as pending, not thrown", async () => {
  await withEnv(ENV, () =>
    withFetch(
      (url) =>
        url.includes("/oauth/")
          ? TOKEN
          : reply(500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }),
      async () => {
        const out = await queryStkStatus({ checkoutRequestId: "ws_CO_1" });
        assert.equal(out.ResultCode, "500.001.1001");
      }
    )
  );
});

test("production uses the live Safaricom host, sandbox the sandbox host", async () => {
  await withEnv({ ...ENV, DARAJA_ENV: "production" }, () =>
    withFetch(
      (url) => (url.includes("/oauth/") ? TOKEN : STK_OK),
      async (calls) => {
        await stkPush(stkArgs);
        assert.ok(calls.every((c) => c.url.startsWith("https://api.safaricom.co.ke")));
      }
    )
  );
  await withEnv(ENV, () =>
    withFetch(
      (url) => (url.includes("/oauth/") ? TOKEN : STK_OK),
      async (calls) => {
        await stkPush(stkArgs);
        assert.ok(calls.every((c) => c.url.startsWith("https://sandbox.safaricom.co.ke")));
      }
    )
  );
});
