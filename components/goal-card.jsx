"use client";

import { motion } from "framer-motion";
import { formatKES, formatDate } from "@/lib/utils";

export function GoalCard({ goal }) {
  const pct = goal.target_amount > 0
    ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
    : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">{goal.name}</h4>
        {goal.completed && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            Reached
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatKES(goal.current_amount)} of {formatKES(goal.target_amount)}
        {goal.target_date && ` · by ${formatDate(goal.target_date)}`}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
