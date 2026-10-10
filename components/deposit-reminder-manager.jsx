"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { SettingsRow } from "@/components/settings-row";
import { useT } from "@/components/language-provider";
import { parseAmount } from "@/lib/spending";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const selectClass =
  "flex h-12 w-full rounded-xl border border-border bg-background px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function summary(r) {
  if (!r) return "Off";
  if (!r.active) return "Paused";
  return r.frequency === "weekly" ? `Weekly · ${DAYS[r.day_of_week].slice(0, 3)}` : `Monthly · day ${r.day_of_month}`;
}

export function DepositReminderManager() {
  const supabase = createClient();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reminder, setReminder] = useState(null);
  const [form, setForm] = useState({ frequency: "weekly", dayOfWeek: 5, dayOfMonth: 1, amount: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("deposit_reminders").select("*").maybeSingle();
    if (loadError) return setError("Couldn't load your reminder.");
    setReminder(data ?? null);
    if (data) {
      setForm({
        frequency: data.frequency,
        dayOfWeek: data.day_of_week ?? 5,
        dayOfMonth: data.day_of_month ?? 1,
        amount: data.amount ? String(data.amount) : "",
      });
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    let amount = null;
    if (form.amount.trim() !== "") {
      amount = parseAmount(form.amount);
      if (amount === null) return setError("Enter a valid amount, or leave it blank.");
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return setError("Your session expired — please log in again.");
    }
    const weekly = form.frequency === "weekly";
    const { error: saveError } = await supabase.from("deposit_reminders").upsert(
      {
        user_id: user.id,
        frequency: form.frequency,
        day_of_week: weekly ? Number(form.dayOfWeek) : null,
        day_of_month: weekly ? null : Number(form.dayOfMonth),
        amount,
        active: true,
        last_sent_on: null,
      },
      { onConflict: "user_id" }
    );
    setSaving(false);
    if (saveError) return setError("Couldn't save your reminder. Please try again.");
    setOpen(false);
    load();
  }

  async function handleRemove() {
    const { error: deleteError } = await supabase.from("deposit_reminders").delete().eq("user_id", reminder.user_id);
    if (deleteError) return setError("Couldn't turn off the reminder.");
    setReminder(null);
    setForm({ frequency: "weekly", dayOfWeek: 5, dayOfMonth: 1, amount: "" });
    setOpen(false);
  }

  return (
    <>
      <SettingsRow icon={BellRing} label={t("account.depositReminder")} value={summary(reminder)} onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title={t("account.depositReminder")}>
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            We&rsquo;ll send you a notification on the day you choose, so topping up becomes a habit. Turn on push notifications above to get it on your phone.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="dr-freq">Remind me</Label>
            <select id="dr-freq" className={selectClass} value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>
          {form.frequency === "weekly" ? (
            <div className="space-y-1.5">
              <Label htmlFor="dr-dow">On</Label>
              <select id="dr-dow" className={selectClass} value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: e.target.value }))}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="dr-dom">On day of the month</Label>
              <select id="dr-dom" className={selectClass} value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="dr-amount">Suggested amount (KES, optional)</Label>
            <Input id="dr-amount" inputMode="decimal" autoComplete="off" placeholder="e.g. 500" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving…" : reminder ? "Update reminder" : "Turn on reminder"}</Button>
          {reminder && (
            <Button type="button" variant="outline" className="w-full" onClick={handleRemove}>Turn off</Button>
          )}
        </form>
      </Sheet>
    </>
  );
}
