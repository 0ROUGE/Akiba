import { createHmac, timingSafeEqual } from "node:crypto";

// Safaricom's callbacks carry no signature, so anyone who learns a transaction
// reference could post a fake "success". Every callback URL we hand to Safaricom
// therefore carries a secret token (?k=...) that only the server can produce;
// the callback routes reject requests without it. No new env var is needed - the
// token is derived from a server secret you already have (override with
// MPESA_CALLBACK_SECRET if you like).

function secret() {
  const s =
    process.env.MPESA_CALLBACK_SECRET || process.env.TOTP_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No callback signing secret configured");
  return s;
}

export function callbackToken() {
  return createHmac("sha256", secret()).update("akiba-mpesa-callback-v1").digest("hex");
}

export function withCallbackToken(url) {
  return `${url}?k=${callbackToken()}`;
}

export function isValidCallbackRequest(request) {
  try {
    const given = new URL(request.url).searchParams.get("k") || "";
    const a = Buffer.from(given);
    const b = Buffer.from(callbackToken());
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
