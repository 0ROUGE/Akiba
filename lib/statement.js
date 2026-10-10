// Pure helpers for the statement page.

const IN_TYPES = new Set(["deposit"]);

export function directionOf(type) {
  return IN_TYPES.has(type) ? "In" : "Out";
}

// Africa/Nairobi, "2026-10-08 14:32" — unambiguous and sorts correctly in a spreadsheet.
export function formatNairobi(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Nairobi",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

// Totals only ever count CONFIRMED rows — pending and failed movements didn't happen (yet).
export function summarizeLedger(rows) {
  const out = { deposits: 0, withdrawals: 0, allocations: 0, spend: 0, count: 0 };
  for (const r of rows ?? []) {
    if (r.mpesa_transaction_status !== "confirmed") continue;
    const amt = Number(r.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    out.count += 1;
    if (r.type === "deposit") out.deposits += amt;
    else if (r.type === "withdrawal") out.withdrawals += amt;
    else if (r.type === "allocation") out.allocations += amt;
    else if (r.type === "spend") out.spend += amt;
  }
  for (const k of ["deposits", "withdrawals", "allocations", "spend"]) out[k] = Math.round(out[k] * 100) / 100;
  out.net = Math.round((out.deposits - out.withdrawals - out.allocations - out.spend) * 100) / 100;
  return out;
}

// "2026-10-01" → [start, end) as ISO instants, in the browser's local zone (EAT for Kenyan users).
export function dayRangeToIso(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  end.setDate(end.getDate() + 1);
  if (end <= start) return null;
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
