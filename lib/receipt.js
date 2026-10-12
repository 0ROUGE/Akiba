// Pure receipt model, shared by the receipt page (server) and the deposit
// success screen (client). No browser APIs in here so it stays testable.

export const TYPE_LABELS = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  allocation: "Allocation to goal",
  spend: "Spend",
};

// Real M-Pesa transaction codes are 10 upper-case letters/digits (e.g. SLK1ABCD23).
// Until Safaricom's callback lands, the column holds an internal id (a Daraja
// CheckoutRequestID or a UUID) - that must never be shown as an M-Pesa receipt.
const MPESA_CODE_RE = /^[A-Z0-9]{10}$/;

export function formatWhenNairobi(iso) {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(iso));
}

export function buildReceipt(tx, formatAmount) {
  const label = TYPE_LABELS[tx.type] ?? "Transaction";
  const amount = formatAmount(tx.amount);
  const code = typeof tx.mpesa_receipt_number === "string" ? tx.mpesa_receipt_number.trim() : "";
  const shortId = String(tx.id).slice(0, 8);

  const rows = [
    ["Type", label],
    ["Amount", amount],
    ["Date", formatWhenNairobi(tx.created_at)],
    ...(MPESA_CODE_RE.test(code) ? [["M-Pesa receipt no.", code]] : []),
    ...(tx.description ? [["Description", tx.description]] : []),
    ["AKIBA reference", shortId.toUpperCase()],
  ];

  const text = ["AKIBA receipt", ...rows.map(([k, v]) => `${k}: ${v}`), "Status: Confirmed"].join("\n");

  return { label, amount, rows, text, filename: `akiba-receipt-${shortId}.png` };
}
