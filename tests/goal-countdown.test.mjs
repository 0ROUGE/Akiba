import test from "node:test";
import assert from "node:assert/strict";
import { nairobiToday, daysUntil, countdown, weeklyPace, nextDeadline } from "../lib/goal-countdown.js";

// 2026-10-12 12:00 Nairobi = 09:00Z
const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);

test("'today' is the Nairobi date, even when the UTC date is still yesterday", () => {
  assert.equal(nairobiToday(Date.UTC(2026, 9, 12, 21, 30)), "2026-10-13"); // 00:30 Oct 13 in Nairobi
  assert.equal(nairobiToday(Date.UTC(2026, 9, 12, 20, 59)), "2026-10-12"); // 23:59 Oct 12 in Nairobi
  assert.equal(nairobiToday(NOW), "2026-10-12");
});

test("daysUntil counts whole calendar days and tolerates timestamps", () => {
  assert.equal(daysUntil("2026-10-12", NOW), 0);
  assert.equal(daysUntil("2026-10-13", NOW), 1);
  assert.equal(daysUntil("2026-10-19", NOW), 7);
  assert.equal(daysUntil("2026-10-09", NOW), -3);
  assert.equal(daysUntil("2026-10-20T00:00:00Z", NOW), 8);
  assert.equal(daysUntil("2027-01-01", NOW), 81);
});

test("daysUntil returns null for missing or invalid dates instead of guessing", () => {
  for (const bad of [null, undefined, "", "soon", "12/10/2026", "2026-13-45"]) assert.equal(daysUntil(bad, NOW), null, String(bad));
});

test("countdown labels and states", () => {
  const at = (date) => countdown(date, { now: NOW });
  assert.deepEqual(at("2026-10-12"), { state: "today", days: 0, label: "Due today" });
  assert.deepEqual(at("2026-10-13"), { state: "soon", days: 1, label: "1 day left" });
  assert.deepEqual(at("2026-10-19"), { state: "soon", days: 7, label: "7 days left" });
  assert.deepEqual(at("2026-10-20"), { state: "ok", days: 8, label: "8 days left" });
  assert.deepEqual(at("2026-12-10"), { state: "ok", days: 59, label: "59 days left" });
  assert.deepEqual(at("2026-12-11"), { state: "ok", days: 60, label: "about 2 months left" });
  assert.deepEqual(at("2027-01-20"), { state: "ok", days: 100, label: "about 3 months left" });
  assert.deepEqual(at("2026-10-11"), { state: "overdue", days: -1, label: "1 day overdue" });
  assert.deepEqual(at("2026-10-07"), { state: "overdue", days: -5, label: "5 days overdue" });
});

test("a reached goal is 'done' whatever its date, and no date means no countdown", () => {
  assert.equal(countdown("2020-01-01", { completed: true, now: NOW }).state, "done");
  assert.equal(countdown(null, { now: NOW }), null);
});

test("weeklyPace rounds up and only applies when it makes sense", () => {
  assert.equal(weeklyPace({ target_amount: 7000, current_amount: 0, target_date: "2026-10-26" }, NOW), 3500); // 14 days = 2 weeks
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 0, target_date: "2026-10-26" }, NOW), 500);
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 1, target_date: "2026-10-26" }, NOW), 500); // ceil(999/2)
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 0, target_date: "2026-10-13" }, NOW), 7000); // 1 day left
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 1000, target_date: "2026-10-26" }, NOW), null); // already there
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 0, target_date: "2026-10-12" }, NOW), null); // due today
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 0, target_date: "2026-10-01" }, NOW), null); // overdue
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 0, target_date: null }, NOW), null);
  assert.equal(weeklyPace({ target_amount: 1000, current_amount: 0, target_date: "2026-10-26", completed: true }, NOW), null);
  assert.equal(weeklyPace(null, NOW), null);
});

test("nextDeadline picks the most urgent open goal, overdue first", () => {
  const goals = [
    { id: "a", target_date: "2026-11-30" },
    { id: "b", target_date: "2026-10-20" },
    { id: "c", target_date: "2026-10-01", completed: true },
    { id: "d", target_date: null },
    { id: "e", target_date: "2026-12-31" },
  ];
  assert.equal(nextDeadline(goals, NOW).id, "b");
  assert.equal(nextDeadline([...goals, { id: "late", target_date: "2026-10-05" }], NOW).id, "late");
  assert.equal(nextDeadline([{ id: "x", target_date: null }, { id: "y", completed: true, target_date: "2026-10-13" }], NOW), null);
  assert.equal(nextDeadline([], NOW), null);
  assert.equal(nextDeadline(undefined, NOW), null);
});
