"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { SettingsRow } from "@/components/settings-row";
import { NOTIFICATION_GROUPS, isChannelOn } from "@/lib/notification-types";

function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

// Per-type control of push and SMS alerts, a master SMS switch, and the low-balance level.
// Everything also always shows in the in-app bell.
export function NotificationPrefsManager() {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [threshold, setThreshold] = useState("200");
  const [prefs, setPrefs] = useState({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    setSaved("");
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error: loadError } = await supabase
        .from("profiles")
        .select("sms_enabled, low_balance_threshold, notification_prefs")
        .eq("id", user.id)
        .single();
      if (!alive) return;
      if (loadError || !data) {
        setError("Couldn't load your preferences. Please try again.");
      } else {
        setSmsEnabled(data.sms_enabled !== false);
        setThreshold(String(Number(data.low_balance_threshold ?? 200)));
        setPrefs(data.notification_prefs && typeof data.notification_prefs === "object" ? data.notification_prefs : {});
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Writes a patch to the user's own profile row; calls revert() if it fails.
  async function save(patch, revert) {
    setError("");
    setSaved("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      revert();
      setError("Your session expired — please log in again.");
      return false;
    }
    const { error: updateError } = await supabase.from("profiles").update(patch).eq("id", user.id);
    if (updateError) {
      revert();
      setError("Couldn't save that. Please try again.");
      return false;
    }
    setSaved("Saved");
    return true;
  }

  function toggle(channel, item, on) {
    const prev = prefs;
    const next = { ...prev, [channel]: { ...(prev[channel] || {}), [item.type]: on } };
    setPrefs(next);
    save({ notification_prefs: next }, () => setPrefs(prev));
  }

  function toggleSms(on) {
    const prev = smsEnabled;
    setSmsEnabled(on);
    save({ sms_enabled: on }, () => setSmsEnabled(prev));
  }

  async function saveThreshold(e) {
    e.preventDefault();
    const raw = threshold.replace(/,/g, "").trim();
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
      setError("Enter an amount from 0 to 1,000,000 (0 turns the alert off).");
      return;
    }
    setBusy(true);
    await save({ low_balance_threshold: value }, () => {});
    setBusy(false);
  }

  return (
    <>
      <SettingsRow icon={BellRing} label="Notification preferences" onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Notification preferences">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Text messages (SMS)</p>
                <p className="text-xs text-muted-foreground">Master switch for every text sent to your phone.</p>
              </div>
              <Switch checked={smsEnabled} onChange={toggleSms} label="Text messages" />
            </div>

            <form onSubmit={saveThreshold} className="space-y-1.5">
              <Label htmlFor="np-threshold">Low balance alert (KES)</Label>
              <div className="flex gap-2">
                <Input
                  id="np-threshold"
                  inputMode="numeric"
                  autoComplete="off"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                You get a warning when your AKIBA balance drops below this. Enter 0 to turn it off.
              </p>
            </form>

            {NOTIFICATION_GROUPS.map((group) => (
              <div key={group.title}>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h4>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {group.items.map((item) => (
                    <div key={item.type} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-sm">{item.label}</span>
                      <div className="flex items-center gap-4">
                        {item.push && (
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            Push
                            <Switch
                              checked={isChannelOn(prefs, "push", item)}
                              onChange={(on) => toggle("push", item, on)}
                              label={`${item.label} push notification`}
                            />
                          </label>
                        )}
                        {item.sms && (
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            SMS
                            <Switch
                              checked={smsEnabled && isChannelOn(prefs, "sms", item)}
                              disabled={!smsEnabled}
                              onChange={(on) => toggle("sms", item, on)}
                              label={`${item.label} text message`}
                            />
                          </label>
                        )}
                        {!item.push && !item.sms && <span className="text-xs text-muted-foreground">In-app only</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p className="text-xs text-muted-foreground">Everything also appears in the bell inside the app.</p>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            {saved && !error && (
              <p role="status" className="text-sm text-success">
                {saved}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
