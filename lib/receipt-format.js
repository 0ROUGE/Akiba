// Formatting shared by the PDF receipt (server) and the success screen (browser).
// Pure functions only — no Node- or browser-specific APIs.

export const RECEIPT_TYPES = {
  deposit: {
    label: "Deposit",
    success: "Your deposit was successful.",
    total: "Total Amount Deposited:",
    note: "The money has been added to your AKIBA balance.",
    partyLabel: "Deposited from",
  },
  withdrawal: {
    label: "Withdrawal",
    success: "Your withdrawal was successful.",
    total: "Total Amount Withdrawn:",
    note: "The money was sent to your M-Pesa number.",
    partyLabel: "Sent to",
  },
  allocation: {
    label: "Allocation to goal",
    success: "Your savings were moved successfully.",
    total: "Total Amount Saved:",
    note: "The money moved from your AKIBA balance into a savings goal.",
    partyLabel: "Moved to",
  },
  spend: {
    label: "Spend",
    success: "Your transaction was successful.",
    total: "Total Amount:",
    note: "",
    partyLabel: "Paid by",
  },
};

export function receiptRef(id) {
  return String(id ?? "").slice(0, 8).toUpperCase();
}

export function formatKesAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "KES 0.00";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}KES ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

function ordinal(d) {
  if (d % 100 >= 11 && d % 100 <= 13) return `${d}th`;
  return `${d}${{ 1: "st", 2: "nd", 3: "rd" }[d % 10] ?? "th"}`;
}

// "11th Oct 2026, 1:24 pm" in East Africa Time
export function formatReceiptDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${ordinal(Number(parts.day))} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

// "0725455832" / "+254725455832" -> "+254 725 455 832"; "" if it isn't a Kenyan mobile.
export function formatPhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  if (!/^254\d{9}$/.test(d)) return "";
  return `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Ledger descriptions written by the database include raw ids
// ("Allocated to savings goal 8f1e…"). People shouldn't see those.
export function cleanDescription(description) {
  return String(description ?? "")
    .replace(new RegExp(`savings goal ${UUID}`, "gi"), "a savings goal")
    .replace(new RegExp(`\\s*\\(?${UUID}\\)?`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---- success screen ----
const ANNOUNCE_TYPES = new Set(["deposit", "withdrawal", "allocation"]);
const ANNOUNCE_WINDOW_MS = 30 * 60 * 1000;

// Should a realtime ledger row pop the "transaction successful" screen?
// - only CONFIRMED movements (a pending STK push hasn't succeeded yet)
// - deposits, withdrawals and goal allocations (not silent background auto-saves,
//   which already send their own notification)
// - only recent rows, so an old row being touched by a later update never
//   re-announces itself
// - never the same transaction twice
export function shouldAnnounceTransaction(row, seenIds = [], now = Date.now()) {
  if (!row || typeof row !== "object") return false;
  if (row.mpesa_transaction_status !== "confirmed") return false;
  if (!ANNOUNCE_TYPES.has(row.type)) return false;
  if (/^auto-save/i.test(String(row.description ?? ""))) return false;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created) || now - created > ANNOUNCE_WINDOW_MS || created - now > 5 * 60 * 1000) return false;
  if (!row.id || seenIds.includes(row.id)) return false;
  return true;
}
