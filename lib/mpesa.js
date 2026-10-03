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

export async function b2cPayout({ phone, amount, remarks, resultUrl, timeoutUrl }) {
  const shortcode = requireEnv("DARAJA_SHORTCODE");
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
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "BusinessPayment",
      Amount: Math.round(amount),
      PartyA: shortcode,
      PartyB: normalizePhone(phone),
      Remarks: remarks.slice(0, 100),
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
      Occasion: "AKIBA withdrawal",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.errorMessage || "B2C request failed");
  return data; // includes ConversationID / OriginatorConversationID
}
