"use client";

import { useCallback, useEffect, useState } from "react";
import { PiggyBank, Pause, Play, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { SettingsRow } from "@/components/settings-row";
import { useT } from "@/components/language-provider";
import { formatKES, formatDate } from "@/lib/utils";
import { parseAmount } from "@/lib/spending";

const FREQ_LABEL = { daily: "every day", weekly: "every week", monthly: "every month" };
const STATUS_NOTE = {
  insufficient_balance: "Skipped last time — not enough AKIBA balance",
  goal_complete: "Goal complete",
};
const selectClass =
  "flex h-12 w-full rounded-xl border border-border bg-background px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

// First run is one full period from now (not "right away"), so setting a
// rule never surprises you with an immediate transfer.
function firstRun(frequency) {
  const d = new Date();
  if (frequency === "daily") d.setDate(d.getDate() + 1);
  else if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

export function AutoSaveManager() {
  const supabase = createClient();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState([]);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ goalId: "", amount: "", frequency: "weekly" });

  const load = useCallback(async () => {
    const [goalRes, ruleRes] = await Promise.all([
      supabase.from("savings_goals").select("id, name, completed").order("created_at", { ascending: true }),
      supabase.from("auto_save_rules").select("*").order("created_at", { ascending: true }),
    ]);
    if (goalRes.error || ruleRes.error) {
      setError("Couldn't load your auto-save rules.");
      return;
    }
    setError("");
    setGoals(goalRes.data ?? []);
    setRules(ruleRes.data ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const goalName = (id) => goals.find((g) => g.id === id)?.name ?? "Goal";
  const withoutRule = goals.filter((g) => !g.completed && !rules.some((r) => r.goal_id === g.id));
  const activeCount = rules.filter((r) => r.active).length;

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    const amount = parseAmount(form.amount);
    if (!form.goalId) return setError("Choose a goal.");
    if (amount === null) return setError("Enter an amount above 0.");
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return setError("Your session expired — please log in again.");
    }
    const { error: insertError } = await supabase.from("auto_save_rules").insert({
      user_id: user.id,
      goal_id: form.goalId,
      amount,
      frequency: form.frequency,
      next_run_at: firstRun(form.frequency),
    });
    setSaving(false);
    if (insertError) {
      return setError(insertError.code === "23505" ? "That goal already has an auto-save rule." : "Couldn't save the rule. Please try again.");
    }
    setForm({ goalId: "", amount: "", frequency: "weekly" });
    load();
  }

  async function toggle(rule) {
    const patch = rule.active
      ? { active: false }
      : { active: true, next_run_at: firstRun(rule.frequency), last_status: null };
    const { error: updateError } = await supabase.from("auto_save_rules").update(patch).eq("id", rule.id);
    if (updateError) return setError("Couldn't update that rule.");
    load();
  }

  async function remove(rule) {
    if (!window.confirm("Delete this auto-save rule?")) return;
    const { error: deleteError } = await supabase.from("auto_save_rules").delete().eq("id", rule.id);
    if (deleteError) return setError("Couldn't delete that rule.");
    load();
  }

  return (
    <>
      <SettingsRow
        icon={PiggyBank}
        label={t("account.autoSave")}
        value={activeCount ? `${activeCount} active` : "Off"}
        onClick={() => {
          setOpen(true);
          load();
        }}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t("account.autoSave")}>
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Move money from your AKIBA balance into a goal on a schedule. It runs once a day, and skips if your balance is too low.
          </p>

          {rules.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rules.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{goalName(r.goal_id)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatKES(r.amount)} {FREQ_LABEL[r.frequency]}
                        {r.active ? ` · next ${formatDate(r.next_run_at)}` : " · paused"}
                      </p>
                    </div>
                    {r.last_status !== "goal_complete" && (
                      <button onClick={() => toggle(r)} aria-label={r.active ? "Pause rule" : "Resume rule"} className="text-muted-foreground hover:text-foreground">
                        {r.active ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                    )}
                    <button onClick={() => remove(r)} aria-label="Delete rule" className="text-muted-foreground hover:text-danger">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {STATUS_NOTE[r.last_status] && <p className="text-xs text-warning">{STATUS_NOTE[r.last_status]}</p>}
                </li>
              ))}
            </ul>
          )}

          {withoutRule.length > 0 ? (
            <form onSubmit={handleAdd} className="space-y-3" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="as-goal">Goal</Label>
                <select id="as-goal" className={selectClass} value={form.goalId} onChange={(e) => setForm((f) => ({ ...f, goalId: e.target.value }))}>
                  <option value="">Choose a goal…</option>
                  {withoutRule.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="as-amount">Amount (KES)</Label>
                  <Input id="as-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="as-freq">How often</Label>
                  <select id="as-freq" className={selectClass} value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving…" : "Add rule"}</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {goals.length === 0 ? "Create a savings goal first, then you can set up auto-save for it." : "Every open goal already has a rule."}
            </p>
          )}

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </Sheet>
    </>
  );
}
