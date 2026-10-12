// Safaricom Daraja API helpers (STK Push + B2C + STK query). Sandbox by default;
// set DARAJA_ENV=production once you have production credentials & shortcode.
//
// Hardened so a slow or misbehaving Safaricom can't crash a request: every call
// has a timeout, non-JSON error pages are handled, the OAuth token is cached
// (and refreshed once automatically if Safaricom says it expired).
import { isProduction } from "./daraja-env.js";

const REQUEST_TIMEOUT_MS = 9_000;
const TOKEN_SAFETY_MS = 120_000;

let tokenCache = { token: null, expiresAt: 0 };
export function __resetTokenCache() {
  tokenCache = { token: null, expiresAt: 0 };
}

function baseUrl() {
  return isProduction() ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

// fetch with a timeout and a tolerant body parser. Never throws a raw
// AbortError/SyntaxError - callers get a plain Error with a readable message.
async function darajaFetch(path, init, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    throw new Error(
      err?.name === "AbortError"
        ? `${label}: Safaricom took too long to respond. Please try again.`
        : `${label}: couldn't reach Safaricom. Please try again.`
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON (e.g. an HTML gateway error page) */
  }
  return { res, data };
}

export async function getDarajaToken({ force = false } = {}) {
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const consumerKey = requireEnv("DARAJA_CONSUMER_KEY");
  const consumerSecret = requireEnv("DARAJA_CONSUMER_SECRET");
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const { res, data } = await darajaFetch(
    "/oauth/v1/generate?grant_type=client_credentials",
    { headers: { Authorization: `Basic ${credentials}` } },
    "Daraja auth"
  );
  if (!res.ok || !data?.access_token) {
    throw new Error(`Daraja auth failed (HTTP ${res.status}). Check the consumer key and secret.`);
  }
  const ttl = Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3_000_000;
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(ttl - TOKEN_SAFETY_MS, 60_000) };
  return tokenCache.token;
}

// POST with a bearer token; if Safaricom reports the token invalid, fetch a fresh one and retry once.
async function authedPost(path, body, label) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getDarajaToken({ force: attempt > 0 });
    const { res, data } = await darajaFetch(
      path,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      label
    );
    const tokenRejected = res.status === 401 || data?.errorCode === "404.001.03";
    if (tokenRejected && attempt === 0) {
      __resetTokenCache();
      continue;
    }
    return { res, data };
  }
  throw new Error(`${label} failed`);
}

function failure(res, data, fallback) {
  return new Error(data?.errorMessage || data?.ResponseDescription || data?.ResultDesc || `${fallback} (HTTP ${res.status})`);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

// Normalizes Kenyan numbers (07.., +2547.., 2547..) to Daraja's 2547XXXXXXXX format.
export function normalizePhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

export async function stkPush({ phone, amount, accountReference, description, callbackUrl }) {
  const shortcode = requireEnv("DARAJA_SHORTCODE");
  const passkey = requireEnv("DARAJA_PASSKEY");
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");

  const { res, data } = await authedPost(
    "/mpesa/stkpush/v1/processrequest",
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount),
      PartyA: normalizePhone(phone),
      PartyB: shortcode,
      PhoneNumber: normalizePhone(phone),
      CallBackURL: callbackUrl,
      AccountReference: accountReference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    },
    "M-Pesa deposit"
  );
  if (!res.ok || !data) throw failure(res, data, "STK push request failed");
  if (data.ResponseCode !== undefined && String(data.ResponseCode) !== "0") throw failure(res, data, "STK push rejected");
  return data; // includes CheckoutRequestID / MerchantRequestID
}

// The Daraja SANDBOX only pays out to Safaricom's own test MSISDN - any other
// number (including a real phone) is rejected as an unregistered customer.
// So in sandbox only, DARAJA_SANDBOX_MSISDN (254708374149) can stand in for the
// recipient. Hard-disabled when DARAJA_ENV=production.
function b2cRecipient(phone) {
  if (!isProduction() && process.env.DARAJA_SANDBOX_MSISDN) {
    return normalizePhone(process.env.DARAJA_SANDBOX_MSISDN);
  }
  return normalizePhone(phone);
}

// v3 B2C requires US to generate OriginatorConversationID; the caller stores it as
// the key to match the eventual callback against. B2C uses its OWN shortcode
// (the sandbox 600XXX one, not the STK 174379).
export async function b2cPayout({ phone, amount, remarks, resultUrl, timeoutUrl, originatorConversationId }) {
  const shortcode = process.env.DARAJA_B2C_SHORTCODE || requireEnv("DARAJA_SHORTCODE");
  const initiatorName = requireEnv("DARAJA_INITIATOR_NAME");
  const securityCredential = requireEnv("DARAJA_SECURITY_CREDENTIAL");

  const { res, data } = await authedPost(
    "/mpesa/b2c/v3/paymentrequest",
    {
      OriginatorConversationID: originatorConversationId,
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "BusinessPayment",
      Amount: Math.round(amount),
      PartyA: shortcode,
      PartyB: b2cRecipient(phone),
      Remarks: remarks.slice(0, 100),
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
      Occasion: "AKIBA withdrawal",
    },
    "M-Pesa withdrawal"
  );
  if (!res.ok || !data) throw failure(res, data, "B2C request failed");
  if (data.ResponseCode !== undefined && String(data.ResponseCode) !== "0") throw failure(res, data, "B2C rejected");
  return data; // includes ConversationID (Safaricom's own id)
}

// STK Push Query - asks Safaricom directly what happened to a deposit when its
// callback never arrives. The only trustworthy way to resolve a stuck 'pending' row.
export async function queryStkStatus({ checkoutRequestId }) {
  const shortcode = requireEnv("DARAJA_SHORTCODE");
  const passkey = requireEnv("DARAJA_PASSKEY");
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");

  const { res, data } = await authedPost(
    "/mpesa/stkpushquery/v1/query",
    { BusinessShortCode: shortcode, Password: password, Timestamp: ts, CheckoutRequestID: checkoutRequestId },
    "M-Pesa status check"
  );
  // While the customer hasn't answered yet Safaricom replies HTTP 500 / 500.001.1001.
  if (!res.ok && data?.errorCode === "500.001.1001") {
    return { ResultCode: "500.001.1001", ResultDesc: data.errorMessage || "Still processing" };
  }
  if (!res.ok || !data) throw failure(res, data, "STK status query failed");
  return data; // ResultCode: "0" = confirmed, "1032" = cancelled by user, others = failed
}
