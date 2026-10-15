import crypto from "node:crypto";

// AES-256-GCM encryption for data at rest (the TOTP secret). Keys come from server-only
// env vars - never exposed to the client, never committed.
//
// TOTP_ENCRYPTION_KEY is the dedicated key (generate one with: openssl rand -base64 32).
// If it has not been configured, a key derived from the server's service-role secret is
// used instead, so two-factor setup works out of the box instead of failing. Encryption
// always uses the best key available; decryption tries every candidate, so secrets made
// under the fallback keep working after TOTP_ENCRYPTION_KEY is added later (and vice versa).
function candidateKeys() {
  const keys = [];
  const primary = process.env.TOTP_ENCRYPTION_KEY;
  if (primary) keys.push(crypto.createHash("sha256").update(primary).digest());
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fallback) keys.push(crypto.createHash("sha256").update(`akiba-totp-fallback|${fallback}`).digest());
  if (!keys.length) throw new Error("No encryption key configured: set TOTP_ENCRYPTION_KEY");
  return keys;
}

export function isEncryptionConfigError(err) {
  return String(err?.message || "").startsWith("No encryption key configured");
}

export function encryptSecret(plaintext) {
  const key = candidateKeys()[0];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  let lastError;
  for (const key of candidateKeys()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (err) {
      lastError = err; // wrong key: GCM authentication fails, try the next candidate
    }
  }
  throw lastError;
}
