import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_TYPES,
  DEFAULT_FILTERS,
  applyToQuery,
  hasActiveFilters,
  nairobiDayStart,
  nairobiNextDayStart,
  normalizeFilters,
  parseMoney,
  sanitizeSearch,
} from "../lib/activity-filters.js";

// A fake Supabase query builder that records every call.
function recorder() {
  const calls = [];
  const q = new Proxy(
    {},
    {
      get: (_t, method) => (...args) => {
        calls.push([method, ...args]);
        return q;
      },
    }
  );
  return { q, calls };
}

test("sanitizeSearch strips anything that could alter a PostgREST filter or LIKE pattern", () => {
  assert.equal(sanitizeSearch("rent, (june)"), "rent june");
  assert.equal(sanitizeSearch('50%_off"'), "50 off");
  assert.equal(sanitizeSearch("a),amount.gt.0,(b"), "a amount.gt.0 b");
  assert.equal(sanitizeSearch("  SLK1ABCD23  "), "SLK1ABCD23");
  assert.equal(sanitizeSearch("M-Pesa deposit"), "M-Pesa deposit");
  assert.equal(sanitizeSearch(null), "");
  assert.equal(sanitizeSearch("x".repeat(100)).length, 40);
  assert.doesNotMatch(sanitizeSearch("a,b(c)d%e_f*g\\h'i\"j"), /[,()%_*\\'"]/);
});

test("Nairobi day boundaries are UTC+3", () => {
  assert.equal(nairobiDayStart("2026-10-12"), "2026-10-11T21:00:00.000Z");
  assert.equal(nairobiNextDayStart("2026-10-12"), "2026-10-12T21:00:00.000Z");
  assert.equal(nairobiDayStart(""), null);
  assert.equal(nairobiDayStart("12/10/2026"), null);
  assert.equal(nairobiDayStart("2026-13-45"), null);
});

test("parseMoney: blank is no bound, junk is invalid", () => {
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("  "), null);
  assert.equal(parseMoney("1,500"), 1500);
  assert.equal(parseMoney("0"), 0);
  assert.equal(parseMoney("12.5"), 12.5);
  for (const bad of ["abc", "-5", "1e999", "NaN", "999999999999"]) assert.ok(Number.isNaN(parseMoney(bad)), bad);
});

test("default filters are valid, match everything and count as inactive", () => {
  const n = normalizeFilters(DEFAULT_FILTERS);
  assert.equal(n.ok, true);
  assert.deepEqual(n.params, { types: null, status: null, q: "", min: null, max: null, gte: null, lt: null });
  assert.equal(hasActiveFilters(DEFAULT_FILTERS), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, q: "rent" }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, status: "failed" }), true);
});

test("invalid input is reported, not guessed", () => {
  assert.equal(normalizeFilters({ ...DEFAULT_FILTERS, min: "abc" }).ok, false);
  assert.equal(normalizeFilters({ ...DEFAULT_FILTERS, min: "500", max: "100" }).ok, false);
  assert.equal(normalizeFilters({ ...DEFAULT_FILTERS, from: "2026-10-12", to: "2026-10-01" }).ok, false);
  assert.equal(normalizeFilters({ ...DEFAULT_FILTERS, from: "nonsense" }).ok, false);
  assert.equal(normalizeFilters({ ...DEFAULT_FILTERS, from: "2026-10-12", to: "2026-10-12" }).ok, true); // one day
});

test("unknown type/status ids fall back to 'all' instead of breaking the query", () => {
  const n = normalizeFilters({ ...DEFAULT_FILTERS, type: "hacker", status: "x" });
  assert.equal(n.ok, true);
  assert.equal(n.params.types, null);
  assert.equal(n.params.status, null);
});

test("every filter is applied to the query", () => {
  const { q, calls } = recorder();
  const n = normalizeFilters({
    q: "rent", type: "withdrawal", status: "confirmed", from: "2026-10-01", to: "2026-10-12", min: "100", max: "5,000",
  });
  applyToQuery(q, n.params);
  assert.deepEqual(calls, [
    ["in", "type", ["withdrawal"]],
    ["eq", "mpesa_transaction_status", "confirmed"],
    ["gte", "created_at", "2026-09-30T21:00:00.000Z"],
    ["lt", "created_at", "2026-10-12T21:00:00.000Z"],
    ["gte", "amount", 100],
    ["lte", "amount", 5000],
    ["or", "description.ilike.%rent%,mpesa_receipt_number.ilike.%rent%"],
  ]);
});

test("no filters adds nothing; a zero minimum is still applied", () => {
  const a = recorder();
  applyToQuery(a.q, normalizeFilters(DEFAULT_FILTERS).params);
  assert.equal(a.calls.length, 0);
  const b = recorder();
  applyToQuery(b.q, normalizeFilters({ ...DEFAULT_FILTERS, min: "0" }).params);
  assert.deepEqual(b.calls, [["gte", "amount", 0]]);
});

test("the 'Goals' chip maps to allocations", () => {
  assert.deepEqual(ACTIVITY_TYPES.find((t) => t.id === "goals").types, ["allocation"]);
});
