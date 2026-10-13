// Withdrawal PIN: format rules + salted, peppered scrypt hashing. Pure node:crypto
// (no framework imports) so it is unit-testable.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export function validatePinFormat(pin) {
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) return { ok: false, error: "Use 4 to 6 digits." };
  if (/^(\d)\1+$/.test(pin)) return { ok: false, error: "Choose a PIN that isn't all the same digit." };
  const d = [...pin].map(Number);
  const ascending = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  const descending = d.every((v, i) => i === 0 || v === d[i - 1] - 1);
  if (ascending || descending) return { ok: false, error: "Choose a PIN that isn't a simple sequence." };
  return { ok: true };
}

// A 4-6 digit PIN has very little entropy, so the hash also mixes in a server-side
// pepper: a leaked database alone can't be brute-forced offline.
function pepper() {
  const s = process.env.AKIBA_PIN_PEPPER || process.env.TOTP_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No PIN pepper configured");
  return s;
}
const material = (userId, pin) => `${pepper()}|${userId}|${pin}`;

export async function hashPin(userId, pin) {
  const salt = randomBytes(16);
  const key = await scryptAsync(material(userId, pin), salt, 32);
  return `scrypt1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPin(userId, pin, stored) {
  try {
    const [version, saltHex, keyHex] = String(stored).split("$");
    if (version !== "scrypt1" || !saltHex || !keyHex) return false;
    const expected = Buffer.from(keyHex, "hex");
    const actual = await scryptAsync(material(userId, pin), Buffer.from(saltHex, "hex"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
