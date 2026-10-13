import * as OTPAuth from "otpauth";
import { decryptSecret } from "@/lib/crypto";
import { signToken, verifyToken } from "@/lib/signed-cookie";
import { freshPasskeyAuth } from "@/lib/passkey-amr";

// Server-side "step-up" re-authentication used before money leaves: a withdrawal PIN
// or a fresh biometric check mints a short-lived signed cookie (5 min) that the
// withdrawal / payout-plan routes require. Wrong guesses are rate-limited by the
// step_up_* database functions (5 misses -> 15 min lock, doubling).

export const STEP_UP_COOKIE = "akiba_stepup";
const STEP_UP_TTL_MS = 5 * 60 * 1000;

export async function issueStepUp(response, userId) {
  const token = await signToken("stepup", userId, STEP_UP_TTL_MS);
  response.cookies.set(STEP_UP_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: STEP_UP_TTL_MS / 1000,
  });
}

export function clearStepUp(response) {
  response.cookies.set(STEP_UP_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function hasStepUp(request, userId) {
  return verifyToken("stepup", request.cookies.get(STEP_UP_COOKIE)?.value, userId);
}

// ---- lockout (scope: "pin" | "totp") ----
export async function lockedUntil(admin, userId, scope) {
  const { data, error } = await admin.rpc("step_up_locked", { p_user: userId, p_scope: scope });
  if (error) throw new Error(error.message);
  return data ? new Date(data) : null;
}
export async function recordFailure(admin, userId, scope) {
  const { data, error } = await admin.rpc("step_up_fail", { p_user: userId, p_scope: scope });
  if (error) throw new Error(error.message);
  return data; // { locked_until, remaining }
}
export async function recordSuccess(admin, userId, scope) {
  const { error } = await admin.rpc("step_up_ok", { p_user: userId, p_scope: scope });
  if (error) console.error("step_up_ok failed:", error.message);
}

export function lockMessage(until) {
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  if (mins >= 60) {
    const hours = Math.ceil(mins / 60);
    return `Too many wrong attempts. Try again in ${hours} hour${hours === 1 ? "" : "s"}.`;
  }
  return `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

export function failureMessage(result, what) {
  if (result?.locked_until) return lockMessage(new Date(result.locked_until));
  const left = Number(result?.remaining ?? 0);
  return `That ${what} didn't match. ${left} attempt${left === 1 ? "" : "s"} left.`;
}

// ---- TOTP ----
export async function verifyTotpCode(admin, user, code) {
  const { data: profile } = await admin
    .from("profiles")
    .select("two_factor_secret")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.two_factor_secret) return { ok: false, reason: "no-2fa" };

  const totp = new OTPAuth.TOTP({
    issuer: "AKIBA",
    label: user.email || user.id,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: decryptSecret(profile.two_factor_secret),
  });
  // window: 1 tolerates +/-30s of clock drift between the authenticator app and server
  return { ok: totp.validate({ token: String(code).trim().slice(0, 10), window: 1 }) !== null };
}

// One guarded attempt at the withdrawal PIN / authenticator code, with lockout.
// Returns { ok } or { ok:false, status, error }.
export async function attemptWithLockout(admin, userId, scope, check) {
  const until = await lockedUntil(admin, userId, scope);
  if (until) return { ok: false, status: 429, error: lockMessage(until) };
  if (await check()) {
    await recordSuccess(admin, userId, scope);
    return { ok: true };
  }
  const result = await recordFailure(admin, userId, scope);
  return {
    ok: false,
    status: result?.locked_until ? 429 : 401,
    error: failureMessage(result, scope === "pin" ? "PIN" : "code"),
  };
}

// ---- biometrics ----
// A fresh passkey sign-in must be proven two ways: this session's token says it came
// from a passkey (amr), AND the database says a passkey enrolled >= 24h ago was used in
// the last 3 minutes - so a stolen password can't be used to enrol an attacker's passkey
// and skip TOTP / the PIN straight away.
export async function verifyFreshPasskey(supabase, admin, userId) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const amr = freshPasskeyAuth(session?.access_token);
  if (!amr.ok) return { ok: false, reason: "session-not-passkey", methods: amr.methods };

  const { data: trusted, error } = await admin.rpc("passkey_login_trusted", { p_user: userId });
  if (error || !trusted) return { ok: false, reason: "passkey-not-trusted", methods: amr.methods };
  return { ok: true, methods: amr.methods };
}

// ---- the gate used by money-out routes ----
export async function checkWithdrawalGate(request, admin, userId) {
  const { data: pin, error } = await admin
    .from("withdrawal_pins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pin) return { ok: false, code: "PIN_REQUIRED", error: "Set a withdrawal PIN to continue." };
  if (!(await hasStepUp(request, userId))) {
    return { ok: false, code: "STEP_UP_REQUIRED", error: "Confirm it's you with your PIN or biometrics." };
  }
  return { ok: true };
}
