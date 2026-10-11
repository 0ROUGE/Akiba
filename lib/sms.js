// Africa's Talking SMS client. SERVER-ONLY: secrets come from env vars and must
// never be imported into a client component.
//
// Env:
//   AT_API_KEY    - Africa's Talking API key (Vercel *Secret*)
//   AT_USERNAME   - your AT app username ("sandbox" for the sandbox environment)
//   AT_SENDER_ID  - optional approved sender ID / shortcode

const LIVE_URL = "https://api.africastalking.com/version1/messaging";
const SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging";

// Per-recipient statusCode values: 100 Processed, 101 Sent, 102 Queued.
const SUCCESS_CODES = new Set([100, 101, 102]);
// 403 InvalidPhoneNumber, 404 UnsupportedNumberType, 406 UserInBlacklist (opted out).
// Retrying these can never succeed.
const PERMANENT_CODES = new Set([403, 404, 406]);

export function smsConfigured() {
  return Boolean(process.env.AT_API_KEY && process.env.AT_USERNAME);
}

// Any common Kenyan mobile format -> "+2547XXXXXXXX" / "+2541XXXXXXXX", else null.
export function toMsisdn(phone) {
  const d = String(phone ?? "").replace(/\D/g, "");
  let national = null;
  if (d.length === 12 && d.startsWith("254")) national = d.slice(3);
  else if (d.length === 10 && d.startsWith("0")) national = d.slice(1);
  else if (d.length === 9) national = d;
  return national && /^[17]\d{8}$/.test(national) ? `+254${national}` : null;
}

// Returns { ok, messageId?, permanent?, notConfigured?, error? } and never throws.
export async function sendSms(to, message, { fetchImpl } = {}) {
  const msisdn = toMsisdn(to);
  if (!msisdn) return { ok: false, permanent: true, error: "invalid phone number" };

  const text = String(message ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, 160);
  if (!text) return { ok: false, permanent: true, error: "empty message" };

  if (!smsConfigured()) {
    return { ok: false, permanent: false, notConfigured: true, error: "AT_API_KEY / AT_USERNAME not set" };
  }

  const doFetch = fetchImpl || globalThis.fetch;
  const url = process.env.AT_USERNAME === "sandbox" ? SANDBOX_URL : LIVE_URL;
  const params = new URLSearchParams({ username: process.env.AT_USERNAME, to: msisdn, message: text });
  if (process.env.AT_SENDER_ID) params.set("from", process.env.AT_SENDER_ID);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        apiKey: process.env.AT_API_KEY,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) {
      return { ok: false, permanent: false, error: `Africa's Talking HTTP ${res.status}: ${raw.slice(0, 160)}` };
    }

    const recipient = json?.SMSMessageData?.Recipients?.[0];
    if (!recipient) {
      return { ok: false, permanent: false, error: json?.SMSMessageData?.Message || "no recipient in response" };
    }
    if (SUCCESS_CODES.has(Number(recipient.statusCode))) {
      return { ok: true, messageId: recipient.messageId || null };
    }
    return {
      ok: false,
      permanent: PERMANENT_CODES.has(Number(recipient.statusCode)),
      error: `${recipient.status || "Failed"} (${recipient.statusCode})`,
    };
  } catch (err) {
    return { ok: false, permanent: false, error: err?.name === "AbortError" ? "timed out" : String(err?.message || err).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}
