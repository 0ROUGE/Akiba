import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { countdown, weeklyPace } from "@/lib/goal-countdown";
import { formatKES, formatDate } from "@/lib/utils";

const TONE = {
  ok: "bg-primary/10 text-primary",
  soon: "bg-warning/15 text-warning",
  today: "bg-warning/15 text-warning",
  overdue: "bg-danger/10 text-danger",
};

// Small pill for a goal card: "12 days left", "Due today", "3 days overdue".
export function CountdownBadge({ goal }) {
  const c = goal.target_date ? countdown(goal.target_date, { completed: goal.completed }) : null;
  if (!c || c.state === "done") return null;
  return (
    <span
      suppressHydrationWarning
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[c.state]}`}
    >
      <CalendarClock size={12} /> {c.label}
    </span>
  );
}

// Home-screen widget for the open goal with the nearest deadline.
export function NextDeadlineWidget({ goal }) {
  if (!goal) return null;
  const c = countdown(goal.target_date, { completed: false });
  if (!c) return null;
  const pace = weeklyPace(goal);
  const n = c.state === "today" ? 0 : Math.abs(c.days);
  const unit = c.state === "overdue" ? "late" : c.state === "today" ? "today" : n === 1 ? "day" : "days";
  const urgent = c.state === "overdue" || c.state === "today" || c.state === "soon";

  return (
    <Link
      href="/dashboard/goals"
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-4">
        <div
          suppressHydrationWarning
          className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl ${
            c.state === "overdue" ? "bg-danger/10 text-danger" : urgent ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"
          }`}
        >
          <span className="font-display text-2xl font-semibold leading-none tabular-nums">{n}</span>
          <span className="mt-1 text-[10px] uppercase tracking-wide">{unit}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Next deadline</p>
          <p className="truncate font-medium">{goal.name}</p>
          <p suppressHydrationWarning className="text-xs text-muted-foreground">
            {c.label} · by {formatDate(goal.target_date)}
          </p>
          {pace ? <p className="mt-1 text-xs">About {formatKES(pace)} a week gets you there.</p> : null}
        </div>
      </div>
    </Link>
  );
}
