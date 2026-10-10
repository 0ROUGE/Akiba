// Turns the machine-readable errors raised by the start_withdrawal() database
// function into something a person can act on.

function kes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "KES 0";
  return `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

function nairobi(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "later";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(d);
}

export function describeWithdrawalError(rawMessage) {
  const msg = String(rawMessage ?? "");

  if (msg.includes("ERR_NO_PHONE")) {
    return { code: "no_phone", message: "Add your M-Pesa phone number in Account before withdrawing." };
  }
  const hold = msg.match(/ERR_PHONE_HOLD:(\S+)/);
  if (hold) {
    return {
      code: "phone_hold",
      message: `For your security, withdrawals are paused for 24 hours after you change your phone number. You can withdraw again after ${nairobi(hold[1])}.`,
    };
  }
  const limit = msg.match(/ERR_DAILY_LIMIT:(\d+(?:\.\d+)?)/);
  if (limit) {
    const remaining = Number(limit[1]);
    return {
      code: "daily_limit",
      message:
        remaining > 0
          ? `That would go over your daily withdrawal limit. You can still withdraw ${kes(remaining)} in the next 24 hours.`
          : "You've reached your daily withdrawal limit. Try again later.",
    };
  }
  if (msg.includes("ERR_INSUFFICIENT")) {
    return { code: "insufficient", message: "Insufficient AKIBA balance" };
  }
  if (msg.includes("ERR_AMOUNT")) {
    return { code: "amount", message: "Invalid amount" };
  }
  return { code: "unknown", message: "Couldn't start the withdrawal. Please try again." };
}
