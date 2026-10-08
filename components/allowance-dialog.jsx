"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { parseAmount, WEEK_MS } from "@/lib/spending";

export function AllowanceDialog({ allowance, onSaved, children }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(allowance ? String(allowance.weekly_amount) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const value = parseAmount(amount);
    if (value === null) {
      setError("Enter a weekly amount above 0.");
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

    let result;
    if (allowance) {
      result = await supabase.from("allowances").update({ weekly_amount: value }).eq("user_id", user.id);
    } else {
      result = await supabase.from("allowances").insert({
        user_id: user.id,
        weekly_amount: value,
        spent_this_week: 0,
        resets_at: new Date(Date.now() + WEEK_MS).toISOString(),
      });
      // Someone (another tab) created it first → just update it.
      if (result.error?.code === "23505") {
        result = await supabase.from("allowances").update({ weekly_amount: value }).eq("user_id", user.id);
      }
    }
    setSaving(false);
    if (result.error) {
      setError("Couldn't save that. Please try again.");
      return;
    }
    setOpen(false);
    onSaved?.();
  }

  return (
    <>
      <span onClick={() => setOpen(true)} role="presentation">{children}</span>
      <Sheet open={open} onClose={() => setOpen(false)} title="Weekly allowance">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            You&rsquo;ll get a notification when your logged spending reaches 80% and 100% of this amount.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="allowance-amount">Weekly amount (KES)</Label>
            <Input id="allowance-amount" inputMode="decimal" autoComplete="off" placeholder="0.00"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Save allowance"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
