import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const KDF = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const PIN_RE = /^\d{6}$/;

// ---- format ---------------------------------------------------------------

function isStraightRun(pin) {
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if (Math.abs(step) !== 1) return false;
  return d.every((n, i) => i === 0 || n - d[i - 1] === step);
}

/** 6 digits, and not one of the PINs people (and attackers) try first. */
export function validatePinFormat(pin) {
  if (typeof pin !== "string" || !PIN_RE.test(pin)) return { ok: false, reason: "format" };
  if (/^(\d)\1{5}$/.test(pin)) return { ok: false, reason: "weak" }; // 000000, 111111
  if (isStraightRun(pin)) return { ok: false, reason: "weak" }; // 123456, 654321
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return { ok: false, reason: "weak" }; // 121212, 123123
  return { ok: true };
}

// ---- hashing --------------------------------------------------------------
// A 6-digit PIN has only 1,000,000 possibilities, so a leaked database alone
// would let someone brute-force it offline in minutes no matter how slow the
// KDF is. The PIN is therefore HMAC'd with a server-side pepper (derived from
// TOTP_ENCRYPTION_KEY, which never touches the database) BEFORE scrypt. A
// stolen database dump without the server secret is useless for guessing.

function pepper() {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key) throw new Error("TOTP_ENCRYPTION_KEY is not set");
  return crypto.createHmac("sha256", key).update("akiba-withdrawal-pin-pepper-v1").digest();
}

function peppered(pin) {
  return crypto.createHmac("sha256", pepper()).update(pin).digest();
}

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(peppered(pin), salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem });
  return `scrypt$${KDF.N}$${KDF.r}$${KDF.p}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

export async function verifyPinHash(pin, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashB64, "base64");
    const dk = await scrypt(peppered(pin), Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: KDF.maxmem,
    });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch {
    return false; // malformed hash or missing pepper: fail closed
  }
}

// ---- attempt-counted checks ----------------------------------------------

async function beginAttempt(admin, userId, scope) {
  const { data, error } = await admin.rpc("begin_step_up_attempt", { p_user: userId, p_scope: scope });
  if (error) throw new Error("Couldn't verify right now");
  return data;
}

/**
 * Verifies a withdrawal PIN. Attempts are reserved atomically in the database
 * BEFORE the comparison so parallel guesses can't beat the lockout.
 * Returns { ok: true } or { ok: false, error, status, ...detail }.
 */
export async function checkPin(admin, userId, pin) {
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return { ok: false, error: "pin_invalid_format", status: 400 };
  }
  const { data: row } = await admin.from("withdrawal_pins").select("pin_hash").eq("user_id", userId).maybeSingle();
  if (!row) return { ok: false, error: "pin_not_set", status: 428 };

  const gate = await beginAttempt(admin, userId, "pin");
  if (gate.status === "locked") {
    return { ok: false, error: "pin_locked", status: 423, lockedUntil: gate.locked_until };
  }
  if (!(await verifyPinHash(pin, row.pin_hash))) {
    return {
      ok: false, error: "pin_wrong", status: 403,
      attemptsLeft: gate.attempts_left, lockedUntil: gate.locked_until ?? null,
    };
  }
  await admin.rpc("reset_step_up_attempts", { p_user: userId, p_scope: "pin" });
  return { ok: true };
}

export { beginAttempt };
