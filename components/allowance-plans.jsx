"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarClock, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatKES, formatDate } from "@/lib/utils";

// Lock a sum out of your balance now; it pays itself back out to your phone
// on a daily or weekly drip automatically — like setting your own allowance
// instead of having to remember to ration one lump sum yourself.
export function AllowancePlans({ balance }) {
  const supabase = createClient();
  const router = useRouter();
  const [plans, setPlans] = useState([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState(null);
  const [form, setForm] = useState({ label: "", totalAmount: "", frequency: "weekly", amountPerRelease: "" });

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("payout_schedules")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setPlans(data ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const res = await fetch("/api/payout-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: form.label || null,
        totalAmount: Number(form.totalAmount),
        frequency: form.frequency,
        amountPerRelease: Number(form.amountPerRelease),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error || "Couldn't create that plan.");
      return;
    }
    setOpen(false);
    setForm({ label: "", totalAmount: "", frequency: "weekly", amountPerRelease: "" });
    await load();
    router.refresh(); // balance card on Home reads from the server
  }

  async function handleCancel(id) {
    setCancellingId(id);
    await fetch(`/api/payout-schedules/${id}/cancel`, { method: "POST" });
    setCancellingId(null);
    await load();
    router.refresh();
  }

  const activePlans = plans.filter((p) => p.status === "active");

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-medium">Allowance plans</h2>
        <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-sm font-medium text-primary">
          <Plus size={15} /> New plan
        </button>
      </div>

      {activePlans.length ? (
        <div className="space-y-3">
          {activePlans.map((plan) => {
            const remaining = Number(plan.total_amount) - Number(plan.released_amount);
            const pct = Math.round((Number(plan.released_amount) / Number(plan.total_amount)) * 100);
            return (
              <Card key={plan.id}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">{plan.label || "Allowance plan"}</h4>
                    <button
                      onClick={() => handleCancel(plan.id)}
                      disabled={cancellingId === plan.id}
                      className="text-xs text-muted-foreground hover:text-danger"
                    >
                      {cancellingId === plan.id ? "Cancelling…" : "Cancel & pay out rest"}
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatKES(plan.amount_per_release)} every {plan.frequency === "daily" ? "day" : "week"} ·{" "}
                    {formatKES(remaining)} left of {formatKES(plan.total_amount)}
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock size={12} /> Next release {formatDate(plan.next_release_at)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No active plans. Lock part of your balance to have it pay itself out on a schedule.
          </CardContent>
        </Card>
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
                <h3 className="font-display text-lg font-medium">New allowance plan</h3>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-label">Name (optional)</Label>
                  <Input id="plan-label" value={form.label} onChange={update("label")} placeholder="Weekly allowance" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-total">Total to lock in (KES)</Label>
                  <Input id="plan-total" type="number" min="1" required value={form.totalAmount} onChange={update("totalAmount")} />
                  <p className="text-xs text-muted-foreground">Available: {formatKES(balance)}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-frequency">Release</Label>
                  <select
                    id="plan-frequency"
                    value={form.frequency}
                    onChange={update("frequency")}
                    className="flex h-12 w-full rounded-xl border border-border bg-background px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-amount">Amount per release (KES)</Label>
                  <Input
                    id="plan-amount"
                    type="number"
                    min="1"
                    required
                    value={form.amountPerRelease}
                    onChange={update("amountPerRelease")}
                  />
                  {form.totalAmount && form.frequency === "daily" && (
                    <p className="text-xs text-muted-foreground">
                      e.g. {formatKES(Number(form.totalAmount) / 7)}/day splits it evenly over a week
                    </p>
                  )}
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Locking in…" : "Start plan"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Each release is a real M-Pesa payout to your phone, sent automatically — no need to come back and withdraw it yourself.
                </p>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
