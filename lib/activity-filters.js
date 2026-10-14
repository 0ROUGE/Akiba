// Filtering for the transaction search page. Pure functions (no framework imports) so
// they are unit-tested; the page only wires them to inputs and to the Supabase query.

export const ACTIVITY_TYPES = [
  { id: "all", label: "All", types: null },
  { id: "deposit", label: "Deposits", types: ["deposit"] },
  { id: "withdrawal", label: "Withdrawals", types: ["withdrawal"] },
  { id: "goals", label: "Goals", types: ["allocation"] },
  { id: "spend", label: "Spending", types: ["spend"] },
];

export const ACTIVITY_STATUSES = [
  { id: "all", label: "Any status", value: null },
  { id: "confirmed", label: "Confirmed", value: "confirmed" },
  { id: "pending", label: "Pending", value: "pending" },
  { id: "failed", label: "Failed", value: "failed" },
];

export const DEFAULT_FILTERS = { q: "", type: "all", status: "all", from: "", to: "", min: "", max: "" };

// The search text goes into a PostgREST `or=(...)` filter and a LIKE pattern, so only
// letters, digits, spaces, dots and hyphens survive: no commas, parentheses, quotes,
// % or _ that could change the meaning of the filter.
export function sanitizeSearch(input) {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Dates are Nairobi calendar days (UTC+3, no daylight saving), so "today" means today in Kenya.
export function nairobiDayStart(dateStr) {
  if (!DAY_RE.test(dateStr || "")) return null;
  const d = new Date(`${dateStr}T00:00:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function nairobiNextDayStart(dateStr) {
  const start = nairobiDayStart(dateStr);
  return start ? new Date(new Date(start).getTime() + 86_400_000).toISOString() : null;
}

// "" -> null (no bound), a valid amount -> number, anything else -> NaN (invalid).
export function parseMoney(input) {
  const raw = String(input ?? "").replace(/,/g, "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? n : Number.NaN;
}

export function hasActiveFilters(f) {
  return Boolean(
    (f.q && f.q.trim()) || (f.type && f.type !== "all") || (f.status && f.status !== "all") || f.from || f.to || f.min || f.max
  );
}

// Validates a filter state and turns it into query parameters.
export function normalizeFilters(f) {
  const type = ACTIVITY_TYPES.find((t) => t.id === f.type) ?? ACTIVITY_TYPES[0];
  const status = ACTIVITY_STATUSES.find((s) => s.id === f.status) ?? ACTIVITY_STATUSES[0];

  const min = parseMoney(f.min);
  const max = parseMoney(f.max);
  if (Number.isNaN(min) || Number.isNaN(max)) return { ok: false, error: "Enter valid amounts." };
  if (min !== null && max !== null && min > max) return { ok: false, error: "The minimum can't be more than the maximum." };

  const gte = f.from ? nairobiDayStart(f.from) : null;
  const lt = f.to ? nairobiNextDayStart(f.to) : null;
  if ((f.from && !gte) || (f.to && !lt)) return { ok: false, error: "Enter valid dates." };
  if (gte && lt && gte >= lt) return { ok: false, error: "The start date must be on or before the end date." };

  return {
    ok: true,
    params: { types: type.types, status: status.value, q: sanitizeSearch(f.q), min, max, gte, lt },
  };
}

// Adds the filters to a Supabase query builder on ledger_transactions.
export function applyToQuery(query, p) {
  let q = query;
  if (p.types) q = q.in("type", p.types);
  if (p.status) q = q.eq("mpesa_transaction_status", p.status);
  if (p.gte) q = q.gte("created_at", p.gte);
  if (p.lt) q = q.lt("created_at", p.lt);
  if (p.min !== null) q = q.gte("amount", p.min);
  if (p.max !== null) q = q.lte("amount", p.max);
  if (p.q) q = q.or(`description.ilike.%${p.q}%,mpesa_receipt_number.ilike.%${p.q}%`);
  return q;
}
