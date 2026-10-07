"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PiggyBank, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatKES, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function GoalCard({ goal }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const pct = goal.target_amount > 0
    ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
    : 0;

  async function handleAllocate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Calls the same allocate_to_goal() Postgres function directly — it
    // checks your balance and moves the money atomically, so this one RPC
    // call is both the validation and the transfer.
    const { error } = await supabase.rpc("allocate_to_goal", {
      p_user_id: user.id,
      p_goal_id: goal.id,
      p_amount: Number(amount),
    });

    setSubmitting(false);
    if (error) {
      setError(error.message.includes("Insufficient") ? "Not enough in your AKIBA balance." : error.message);
      return;
    }
    setOpen(false);
    setAmount("");
    router.refresh();
  }

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

      {!goal.completed && (
        <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setOpen(true)}>
          <PiggyBank size={14} /> Allocate funds
        </Button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-medium">Allocate to {goal.name}</h3>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleAllocate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="allocate-amount">Amount (KES)</Label>
                  <Input
                    id="allocate-amount"
                    type="number"
                    min="1"
                    required
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Allocating…" : "Allocate from balance"}
                </Button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
