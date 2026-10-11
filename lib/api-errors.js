// Pure helpers that turn database / step-up failures into the HTTP status +
// plain-language message the UI shows. Kept free of framework imports so they
// can be unit-tested directly.

const kes = (n) => `KES ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/** Maps an exception raised by the start_withdrawal() Postgres function. */
export function mapWithdrawalError(message = "") {
  const m = String(message);
  if (m.includes("ERR_INSUFFICIENT")) {
    return { status: 400, error: "insufficient", message: "Insufficient AKIBA balance." };
  }
  if (m.includes("ERR_NO_PHONE")) {
    return { status: 400, error: "no_phone", message: "Add a phone number to your profile first." };
  }
  if (m.includes("ERR_AMOUNT")) {
    return { status: 400, error: "invalid_amount", message: "Enter a valid amount." };
  }
  const hold = m.match(/ERR_PHONE_HOLD:(\S+)/);
  if (hold) {
    return {
      status: 423, error: "phone_hold", releasesAt: hold[1],
      message: "You changed your phone number recently. For your security, withdrawals resume after the 24-hour hold.",
    };
  }
  const limit = m.match(/ERR_DAILY_LIMIT:(\d+(?:\.\d+)?)/);
  if (limit) {
    const left = Number(limit[1]);
    return {
      status: 400, error: "daily_limit", remaining: left,
      message: left > 0
        ? `That's over your daily withdrawal limit. You can withdraw up to ${kes(left)} more in the next 24 hours.`
        : "You've reached your daily withdrawal limit. Try again later.",
    };
  }
  return null; // not a known business rule — caller treats as a server error
}

/** Describes a failed PIN / authenticator-code check (see lib/pin.js, lib/totp.js). */
export function describeStepUpFailure(result, what = "PIN") {
  switch (result.error) {
    case "pin_not_set":
      return { status: 428, error: "pin_not_set", message: "Set a withdrawal PIN first." };
    case "pin_invalid_format":
      return { status: 400, error: "pin_invalid_format", message: "Enter your 6-digit PIN." };
    case "code_invalid_format":
      return { status: 400, error: "code_invalid_format", message: "Enter the 6-digit code from your authenticator app." };
    case "2fa_not_set":
      return { status: 400, error: "2fa_not_set", message: "Set up two-factor authentication first." };
    case "pin_locked":
    case "code_locked":
      return {
        status: 423, error: result.error, lockedUntil: result.lockedUntil,
        message: `Too many wrong attempts. For your security, try again later.`,
      };
    case "pin_wrong":
    case "code_wrong": {
      const left = result.attemptsLeft ?? 0;
      const label = result.error === "pin_wrong" ? "PIN" : "code";
      return {
        status: 403, error: result.error, attemptsLeft: left, lockedUntil: result.lockedUntil ?? null,
        message: left > 0
          ? `Wrong ${label}. ${left} attempt${left === 1 ? "" : "s"} left.`
          : `Wrong ${label}. Too many attempts — try again later.`,
      };
    }
    default:
      return { status: result.status || 400, error: result.error || "step_up_failed", message: `Couldn't verify your ${what}.` };
  }
}

/** If the phone number was changed within the last 24h returns when the hold
 *  lifts (ISO string), otherwise null. Mirrors the rule in start_withdrawal(). */
export function phoneHoldUntil(phoneChangedAt, now = Date.now()) {
  if (!phoneChangedAt) return null;
  const releases = new Date(phoneChangedAt).getTime() + 24 * 3600 * 1000;
  return releases > now ? new Date(releases).toISOString() : null;
}

/** Whole-shilling amount between 1 and the cap, or null if invalid. */
export function parseWholeAmount(value, max = 1_000_000) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}
