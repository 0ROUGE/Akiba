// Reads the `amr` (authentication methods) claim from a Supabase access token to
// tell whether THIS session was just created by a passkey (biometric) sign-in.
// A password session carries only a password entry, so it can never satisfy this.
// The access token itself was already validated by supabase.auth.getUser().
//
// The exact method name Supabase uses for passkeys isn't documented, so any method
// containing "passkey" or "webauthn" counts. If it ever doesn't match we FAIL CLOSED
// (the user is simply asked for their TOTP code / PIN) and `methods` is returned so
// the real name is visible in the response.

export function decodeJwtPayload(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function freshPasskeyAuth(accessToken, { windowSec = 120, nowMs = Date.now() } = {}) {
  const amr = decodeJwtPayload(accessToken)?.amr;
  if (!Array.isArray(amr)) return { ok: false, methods: [] };

  const methods = amr.map((e) => (typeof e === "string" ? e : e?.method)).filter(Boolean);
  const nowSec = Math.floor(nowMs / 1000);
  // Needs a timestamp: a bare method name could be a long-lived session refreshed an hour ago.
  const ok = amr.some((e) => {
    if (!e || typeof e !== "object") return false;
    if (!/passkey|webauthn/i.test(String(e.method))) return false;
    const ts = Number(e.timestamp);
    if (!Number.isFinite(ts)) return false;
    const age = nowSec - ts;
    return age <= windowSec && age >= -30;
  });
  return { ok, methods };
}
