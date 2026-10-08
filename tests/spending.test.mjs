import test from "node:test";
import assert from "node:assert/strict";
import { weekWindow, summarizeWeek, allowanceState, parseAmount, categoryLabel, WEEK_MS } from "../lib/spending.js";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

test("weekWindow keeps a future window and rolls a lapsed one by whole weeks", () => {
  const future = NOW + 3 * 86400000;
  assert.deepEqual(weekWindow(new Date(future).toISOString(), NOW), { start: future - WEEK_MS, end: future });
  const lapsed = NOW - 10 * 86400000;
  const w = weekWindow(new Date(lapsed).toISOString(), NOW);
  assert.ok(w.end > NOW && w.end <= NOW + WEEK_MS);
  assert.equal((w.end - lapsed) % WEEK_MS, 0);
  assert.equal(w.end - w.start, WEEK_MS);
});

test("weekWindow tolerates garbage", () => {
  const w = weekWindow("not a date", NOW);
  assert.equal(w.end, NOW + WEEK_MS);
});

test("summarizeWeek totals, groups, sorts and ignores out-of-window / invalid rows", () => {
  const window = { start: NOW - WEEK_MS, end: NOW };
  const iso = (ms) => new Date(ms).toISOString();
  const entries = [
    { amount: 100, category: "food", spent_at: iso(NOW - 1000) },
    { amount: 250.5, category: "transport", spent_at: iso(NOW - 2000) },
    { amount: 50, category: "food", spent_at: iso(NOW - 3000) },
    { amount: 999, category: "bills", spent_at: iso(NOW - WEEK_MS - 1) }, // before window
    { amount: 999, category: "bills", spent_at: iso(NOW) }, // end is exclusive
    { amount: -5, category: "food", spent_at: iso(NOW - 10) },
    { amount: "x", category: "food", spent_at: iso(NOW - 10) },
  ];
  const s = summarizeWeek(entries, window);
  assert.equal(s.total, 400.5);
  assert.deepEqual(s.byCategory.map((c) => [c.id, c.amount]), [["transport", 250.5], ["food", 150]]);
  assert.equal(s.byCategory[0].pct + s.byCategory[1].pct >= 99, true);
  assert.deepEqual(summarizeWeek([], window), { total: 0, byCategory: [] });
  assert.deepEqual(summarizeWeek(null, window), { total: 0, byCategory: [] });
});

test("allowanceState thresholds match the database trigger (80% / 100%)", () => {
  assert.equal(allowanceState(799, 1000).level, "ok");
  assert.equal(allowanceState(800, 1000).level, "warn");
  assert.equal(allowanceState(999.99, 1000).level, "warn");
  assert.equal(allowanceState(1000, 1000).level, "over");
  assert.equal(allowanceState(5000, 1000).pct, 100);
  assert.deepEqual(allowanceState(10, 0), { pct: 0, level: "ok" });
  assert.deepEqual(allowanceState(undefined, undefined), { pct: 0, level: "ok" });
});

test("parseAmount accepts normal money input and rejects the rest", () => {
  assert.equal(parseAmount("1,200"), 1200);
  assert.equal(parseAmount(" 350.5 "), 350.5);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("12.345"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("1e5"), null);
  assert.equal(parseAmount("1000001"), null);
  assert.equal(parseAmount("1000000"), 1000000);
});

test("categoryLabel falls back to Other", () => {
  assert.equal(categoryLabel("food"), "Food");
  assert.equal(categoryLabel("nope"), "Other");
});
