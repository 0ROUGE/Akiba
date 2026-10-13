// HMAC-signed, expiring, user-bound tokens for httpOnly cookies. Uses Web Crypto
// so it runs in BOTH the Edge middleware and Node route handlers (no node: imports).
//
// Why: the old "passed 2FA" cookie was just the user id - anyone with a password-only
// session could set it by hand and skip the authenticator code. A token only the
// server can mint fixes that.
//
// Secret: AKIBA_COOKIE_SECRET, else TOTP_ENCRYPTION_KEY, else SUPABASE_SERVICE_ROLE_KEY
// (the same chain everywhere, so middleware and routes always agree).

const enc = new TextEncoder();

function secret() {
  return process.env.AKIBA_COOKIE_SECRET || process.env.TOTP_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(message) {
  const s = secret();
  if (!s) throw new Error("No cookie signing secret configured");
  const key = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// scope keeps token kinds apart (a "2fa" token is useless as a "stepup" token).
export async function signToken(scope, sub, ttlMs) {
  const exp = Date.now() + ttlMs;
  return `${sub}.${exp}.${await hmac(`${scope}|${sub}|${exp}`)}`;
}

export async function verifyToken(scope, token, sub) {
  try {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [tokenSub, exp, sig] = parts;
    if (tokenSub !== sub) return false;
    const expMs = Number(exp);
    if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
    return safeEqual(sig, await hmac(`${scope}|${tokenSub}|${exp}`));
  } catch {
    return false; // includes "no secret configured": fail closed
  }
}
