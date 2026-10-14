// Goal deadlines. Pure functions (no framework imports) so they are unit-tested.
// All dates are Nairobi calendar days (UTC+3, no daylight saving), so "due today" means
// today in Kenya whatever the server's or the phone's time zone is.

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function nairobiToday(now = Date.now()) {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

// Whole calendar days from today (Nairobi) to a YYYY-MM-DD date. Negative = past. null = no/invalid date.
export function daysUntil(targetDate, now = Date.now()) {
  const m = DATE_RE.exec(String(targetDate ?? ""));
  if (!m) return null;
  const target = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  return Math.round((target - Date.parse(`${nairobiToday(now)}T00:00:00Z`)) / DAY_MS);
}

export function countdown(targetDate, { completed = false, now = Date.now() } = {}) {
  if (completed) return { state: "done", days: null, label: "Reached" };
  const d = daysUntil(targetDate, now);
  if (d === null) return null;
  if (d < 0) return { state: "overdue", days: d, label: `${-d} day${-d === 1 ? "" : "s"} overdue` };
  if (d === 0) return { state: "today", days: 0, label: "Due today" };
  if (d <= 7) return { state: "soon", days: d, label: `${d} day${d === 1 ? "" : "s"} left` };
  if (d < 60) return { state: "ok", days: d, label: `${d} days left` };
  return { state: "ok", days: d, label: `about ${Math.round(d / 30)} months left` };
}

// Roughly how much to put aside each week to reach the target in time. null when it doesn't apply.
export function weeklyPace(goal, now = Date.now()) {
  if (!goal || goal.completed) return null;
  const remaining = Number(goal.target_amount) - Number(goal.current_amount ?? 0);
  const d = daysUntil(goal.target_date, now);
  if (!(remaining > 0) || d === null || d <= 0) return null;
  return Math.ceil(remaining / Math.max(1, d / 7));
}

// The open goal whose deadline is closest (overdue ones come first).
export function nextDeadline(goals, now = Date.now()) {
  const open = (goals ?? []).filter((g) => !g.completed && daysUntil(g.target_date, now) !== null);
  open.sort((a, b) => daysUntil(a.target_date, now) - daysUntil(b.target_date, now));
  return open[0] ?? null;
}
