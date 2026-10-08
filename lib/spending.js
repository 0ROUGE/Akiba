// Helpers for the self-reported spending log + weekly allowance.

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const CATEGORIES = [
  { id: "food", label: "Food" },
  { id: "transport", label: "Transport" },
  { id: "airtime_data", label: "Airtime & data" },
  { id: "bills", label: "Bills" },
  { id: "shopping", label: "Shopping" },
  { id: "health", label: "Health" },
  { id: "entertainment", label: "Entertainment" },
  { id: "education", label: "Education" },
  { id: "other", label: "Other" },
];

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Mirrors the database trigger: the allowance window ends at `resets_at`,
// rolled forward by whole weeks if it has lapsed. Returns ms timestamps.
export function weekWindow(resetsAt, now = Date.now()) {
  let end = new Date(resetsAt).getTime();
  if (!Number.isFinite(end)) end = now + WEEK_MS;
  if (end <= now) end += Math.ceil((now - end) / WEEK_MS) * WEEK_MS;
  return { start: end - WEEK_MS, end };
}

export function summarizeWeek(entries, window) {
  const byId = new Map();
  let total = 0;
  for (const e of entries ?? []) {
    const t = new Date(e.spent_at).getTime();
    const amt = Number(e.amount);
    if (!Number.isFinite(t) || !Number.isFinite(amt) || amt <= 0) continue;
    if (window && (t < window.start || t >= window.end)) continue;
    total += amt;
    byId.set(e.category, (byId.get(e.category) ?? 0) + amt);
  }
  total = round2(total);
  const byCategory = [...byId.entries()]
    .map(([id, amount]) => ({
      id,
      label: categoryLabel(id),
      amount: round2(amount),
      pct: total > 0 ? Math.round((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  return { total, byCategory };
}

export function allowanceState(spent, weekly) {
  const w = Number(weekly);
  const s = Number(spent);
  if (!Number.isFinite(w) || w <= 0) return { pct: 0, level: "ok" };
  const ratio = (Number.isFinite(s) ? s : 0) / w;
  const pct = Math.min(100, Math.round(ratio * 100));
  return { pct, level: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
}

// Parses a money field typed by a person: "1,200", " 350.5 ". Returns a
// number with at most 2 decimals, or null if it isn't a positive amount.
export function parseAmount(input, max = 1_000_000) {
  const cleaned = String(input ?? "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= max ? n : null;
}
