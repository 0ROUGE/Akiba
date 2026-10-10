"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { CATEGORIES, parseAmount } from "@/lib/spending";

const selectClass =
  "flex h-12 w-full rounded-xl border border-border bg-background px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function LogSpendDialog({ onSaved, label = "Log spending" }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setAmount("");
    setCategory("food");
    setNote("");
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const value = parseAmount(amount);
    if (value === null) {
      setError("Enter an amount above 0 (up to 2 decimals).");
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError("Your session expired — please log in again.");
      return;
    }
    const { error: insertError } = await supabase.from("spending_entries").insert({
      user_id: user.id,
      amount: value,
      category,
      note: note.trim() ? note.trim().slice(0, 120) : null,
    });
    setSaving(false);
    if (insertError) {
      setError("Couldn't save that. Please try again.");
      return;
    }
    reset();
    setOpen(false);
    onSaved?.();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus size={15} /> {label}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Log spending">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="spend-amount">Amount (KES)</Label>
            <Input id="spend-amount" inputMode="decimal" autoComplete="off" placeholder="0.00"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-category">Category</Label>
            <select id="spend-category" className={selectClass} value={category}
              onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-note">Note (optional)</Label>
            <Input id="spend-note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
