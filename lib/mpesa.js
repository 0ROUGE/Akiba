// Safaricom Daraja API helpers (STK Push + B2C). Sandbox by default; set
// DARAJA_ENV=production once you have production credentials & shortcode.
const BASE_URL =
  process.env.DARAJA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function getDarajaToken() {
  const consumerKey = requireEnv("DARAJA_CONSUMER_KEY");
  const consumerSecret = requireEnv("DARAJA_CONSUMER_SECRET");
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
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
  const digits = phone.replace(/\D/g, "");
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
  const token = await getDarajaToken();

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.errorMessage || "STK push request failed");
  return data; // includes CheckoutRequestID / MerchantRequestID
}

// The Daraja SANDBOX only pays out to Safaricom's own test MSISDN — any
// other number (including a real phone) is rejected as an unregistered
// customer, and no real money ever moves in sandbox regardless. So in
// sandbox only, DARAJA_SANDBOX_MSISDN (254708374149) can stand in for the
// recipient so the full flow can be exercised end to end. This override is
// hard-disabled when DARAJA_ENV=production: real payouts always go to the
// user's actual phone number.
function b2cRecipient(phone) {
  if (process.env.DARAJA_ENV !== "production" && process.env.DARAJA_SANDBOX_MSISDN) {
    return normalizePhone(process.env.DARAJA_SANDBOX_MSISDN);
  }
  return normalizePhone(phone);
}

// The v3 B2C endpoint — unlike v1 — requires US to generate and supply
// OriginatorConversationID ourselves; Safaricom does not default it, and
// omitting it is what was producing "Bad Request - Invalid
// OriginatorConversationID" on every single withdrawal attempt. We generate
// it before the call so we have it even if the HTTP request itself fails,
// and the caller stores it as the key to match the eventual callback against.
export async function b2cPayout({ phone, amount, remarks, resultUrl, timeoutUrl, originatorConversationId }) {
  // B2C uses its OWN shortcode, separate from the STK Push one. In the
  // sandbox, 174379 is only valid for STK Push; B2C needs the 600XXX
  // shortcode shown on the Daraja portal's Test Credentials page. Using
  // 174379 here is what produced error 2040 ("Credit Party customer type
  // can't be supported by the service") on every withdrawal.
  const shortcode = process.env.DARAJA_B2C_SHORTCODE || requireEnv("DARAJA_SHORTCODE");
  const initiatorName = requireEnv("DARAJA_INITIATOR_NAME");
  const securityCredential = requireEnv("DARAJA_SECURITY_CREDENTIAL");
  const token = await getDarajaToken();

  const res = await fetch(`${BASE_URL}/mpesa/b2c/v3/paymentrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.errorMessage || "B2C request failed");
  return data; // includes ConversationID (Safaricom's own id) + echoes OriginatorConversationID
}

// STK Push Query — lets us ask Safaricom directly what happened to a
// deposit when its callback never arrives (missed webhook, Vercel Hobby's
// cron limits meaning we can't poll every few minutes, etc.). This is the
// only trustworthy way to resolve a stuck 'pending' row — we never guess.
export async function queryStkStatus({ checkoutRequestId }) {
  const shortcode = requireEnv("DARAJA_SHORTCODE");
  const passkey = requireEnv("DARAJA_PASSKEY");
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
  const token = await getDarajaToken();

  const res = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.errorMessage || "STK status query failed");
  return data; // ResultCode: "0" = confirmed, "1032" = cancelled by user, others = failed
}
