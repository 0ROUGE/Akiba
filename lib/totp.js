import * as OTPAuth from "otpauth";
import { decryptSecret } from "./crypto.js";
import { beginAttempt } from "./pin.js";

const CODE_RE = /^\d{6}$/;

export function verifyTotpCode(encryptedSecret, code, label = "AKIBA") {
  try {
    const totp = new OTPAuth.TOTP({
      issuer: "AKIBA", label, algorithm: "SHA1", digits: 6, period: 30,
      secret: decryptSecret(encryptedSecret),
    });
    // window: 1 tolerates ±30s of clock drift between phone and server
    return totp.validate({ token: String(code).trim(), window: 1 }) !== null;
  } catch {
    return false; // undecryptable/garbled secret: fail closed
  }
}

/**
 * Throttled TOTP check against the user's stored (encrypted) secret.
 * Attempts are reserved atomically before comparing, same as the PIN.
 */
export async function checkTotp(admin, userId, code, label) {
  if (typeof code !== "string" || !CODE_RE.test(code)) {
    return { ok: false, error: "code_invalid_format", status: 400 };
  }
  const { data: profile } = await admin
    .from("profiles").select("two_factor_secret, two_factor_enabled").eq("id", userId).single();
  if (!profile?.two_factor_secret || !profile.two_factor_enabled) {
    return { ok: false, error: "2fa_not_set", status: 400 };
  }
  const gate = await beginAttempt(admin, userId, "totp");
  if (gate.status === "locked") {
    return { ok: false, error: "code_locked", status: 423, lockedUntil: gate.locked_until };
  }
  if (!verifyTotpCode(profile.two_factor_secret, code, label)) {
    return { ok: false, error: "code_wrong", status: 403, attemptsLeft: gate.attempts_left, lockedUntil: gate.locked_until ?? null };
  }
  await admin.rpc("reset_step_up_attempts", { p_user: userId, p_scope: "totp" });
  return { ok: true };
}
