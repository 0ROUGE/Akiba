"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function NewGoalDialog({ defaultOpen = false }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", target_amount: "", target_date: "" });

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("savings_goals").insert({
      user_id: user.id,
      name: form.name,
      target_amount: Number(form.target_amount),
      target_date: form.target_date || null,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOpen(false);
    setForm({ name: "", target_amount: "", target_date: "" });
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" className="h-auto w-full flex-col gap-1.5 py-4" onClick={() => setOpen(true)}>
        <Plus size={18} />
        <span className="text-xs">New goal</span>
      </Button>

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
                <h3 className="font-display text-lg font-medium">New savings goal</h3>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="goal-name">Goal name</Label>
                  <Input id="goal-name" required value={form.name} onChange={update("name")} placeholder="Laptop fund" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal-target">Target amount (KES)</Label>
                  <Input id="goal-target" type="number" min="1" required value={form.target_amount} onChange={update("target_amount")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal-date">Target date (optional)</Label>
                  <Input id="goal-date" type="date" value={form.target_date} onChange={update("target_date")} />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Creating…" : "Create goal"}
                </Button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
