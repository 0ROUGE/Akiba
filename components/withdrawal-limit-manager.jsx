"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { SettingsRow } from "@/components/settings-row";
import { useT } from "@/components/language-provider";
import { formatKES } from "@/lib/utils";
import { parseAmount } from "@/lib/spending";

const HOUR = 3600 * 1000;

function fmtWhen(iso) {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(iso));
}

// The limit a withdrawal would actually be checked against right now.
function effectiveLimit(p) {
  if (!p) return null;
  if (p.daily_limit_change_pending && p.daily_limit_next_at && new Date(p.daily_limit_next_at).getTime() <= Date.now()) {
    return p.daily_limit_next;
  }
  return p.daily_withdrawal_limit;
}

export function WithdrawalLimitManager({ profile, onSaved }) {
  const supabase = createClient();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const current = effectiveLimit(profile);
  const pendingActive =
    profile?.daily_limit_change_pending && profile.daily_limit_next_at && new Date(profile.daily_limit_next_at).getTime() > Date.now();
  const holdUntil =
    profile?.phone_changed_at && new Date(profile.phone_changed_at).getTime() + 24 * HOUR > Date.now()
      ? new Date(new Date(profile.phone_changed_at).getTime() + 24 * HOUR).toISOString()
      : null;

  function openSheet() {
    setValue(current ? String(current) : "");
    setError("");
    setMessage("");
    setOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    let next = null;
    if (value.trim() !== "") {
      next = parseAmount(value);
      if (next === null) return setError("Enter a valid amount, or leave it blank for no limit.");
    }
    const delayed = next === null ? current !== null : current !== null && next > current;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return setError("Your session expired — please log in again.");
    }
    const { error: updateError } = await supabase.from("profiles").update({ daily_withdrawal_limit: next }).eq("id", user.id);
    setSaving(false);
    if (updateError) return setError("Couldn't save your limit. Please try again.");
    setMessage(delayed ? "Saved. Raising or removing a limit takes effect in 24 hours." : "Saved. Your new limit is active now.");
    onSaved?.();
  }

  async function cancelPending() {
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setError("Your session expired — please log in again.");
    const { error: updateError } = await supabase.from("profiles").update({ daily_limit_change_pending: false }).eq("id", user.id);
    if (updateError) return setError("Couldn't cancel the change.");
    setMessage("Pending change cancelled.");
    onSaved?.();
  }

  return (
    <>
      <SettingsRow
        icon={ShieldAlert}
        label={t("account.withdrawalLimit")}
        value={current ? formatKES(current) : "None"}
        onClick={openSheet}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t("account.withdrawalLimit")}>
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            Cap how much you can withdraw in any 24 hours — a guard against impulse withdrawals. <strong>Lowering</strong> the limit applies right away; <strong>raising or removing</strong> it takes 24 hours, which gives you time to think.
          </p>

          {holdUntil && (
            <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              Withdrawals are paused until {fmtWhen(holdUntil)} because your phone number was recently changed.
            </div>
          )}

          {pendingActive && (
            <div role="status" className="space-y-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm">
              <p>
                Change to {profile.daily_limit_next ? formatKES(profile.daily_limit_next) : "no limit"} takes effect {fmtWhen(profile.daily_limit_next_at)}.
              </p>
              <button type="button" onClick={cancelPending} className="font-medium text-primary">Cancel this change</button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wl-amount">Daily limit (KES) — leave blank for none</Label>
            <Input id="wl-amount" inputMode="decimal" autoComplete="off" placeholder="e.g. 5,000" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {message && <p role="status" className="text-sm text-success">{message}</p>}
          <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving…" : "Save limit"}</Button>
        </form>
      </Sheet>
    </>
  );
}
