"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogOut, ShieldCheck, KeyRound, Bell, Send, Languages, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush } from "@/lib/push";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { EditProfileDialog } from "@/components/edit-profile-dialog";
import { PasskeyManager } from "@/components/passkey-manager";
import { SettingsRow } from "@/components/settings-row";
import { AutoSaveManager } from "@/components/auto-save-manager";
import { DepositReminderManager } from "@/components/deposit-reminder-manager";
import { WithdrawalLimitManager } from "@/components/withdrawal-limit-manager";
import { useT } from "@/components/language-provider";
import { LANGS, LANG_LABELS } from "@/lib/i18n";

const PUSH_ERROR_KEYS = {
  unsupported: "account.pushUnsupported",
  "permission-denied": "account.pushBlocked",
  "missing-vapid-key": "account.pushNotConfigured",
};

// Deliberately NOT select("*"): the profile row also holds the (encrypted)
// two-factor secret, which the browser has no reason to download.
const PROFILE_COLUMNS =
  "id, full_name, phone, photo_url, dob, two_factor_enabled, phone_changed_at, daily_withdrawal_limit, daily_limit_change_pending, daily_limit_next, daily_limit_next_at";

export default function AccountPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang, setLang } = useT();
  const [profile, setProfile] = useState(null);
  const [shareNotice, setShareNotice] = useState(null);
  const [pushStatus, setPushStatus] = useState(null); // null | "enabled" | "off" | "loading" | error key
  const [testStatus, setTestStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);

  const loadProfile = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single();
    setProfile({ ...data, email: user.email });
  }, [supabase]);

  useEffect(() => {
    loadProfile();

    // Reflect the real subscription state on load, not just "Turn on" every time.
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unsupported");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = await registration?.pushManager.getSubscription();
      setPushStatus(existing ? "enabled" : "off");
    })();
  }, [loadProfile]);

  // Feedback after the OS "Share to AKIBA" flow redirects back here.
  useEffect(() => {
    if (searchParams.get("shared") === "1") setShareNotice("Photo updated from share.");
    if (searchParams.get("shareError") === "1") setShareNotice("Couldn't save the shared photo.");
  }, [searchParams]);

  // File Handler: when AKIBA is launched by the OS to open an image file
  // directly (e.g. "Open with → AKIBA" in a file manager), upload it as the
  // profile photo the same way a share does.
  useEffect(() => {
    if (!("launchQueue" in window)) return;
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files?.length) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const fileHandle = launchParams.files[0];
      const file = await fileHandle.getFile();
      const path = `${user.id}/${Date.now()}-opened-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });

      if (!uploadError) {
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        await supabase.from("profiles").update({ photo_url: data.publicUrl }).eq("id", user.id);
        setShareNotice("Photo updated from the opened file.");
        router.refresh();
      }
    });
  }, [supabase, router]);

  async function handleEnablePush() {
    setPushStatus("loading");
    try {
      await subscribeToPush();
      setPushStatus("enabled");
    } catch (err) {
      setPushStatus(PUSH_ERROR_KEYS[err.message] ? err.message : "error");
    }
  }

  async function handleSendTest() {
    setTestStatus("loading");
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTestStatus(res.ok ? "sent" : data.error || "error");
  }

  async function handleChangePassword() {
    if (!profile?.email) return;
    setResetStatus("loading");
    // The email link lands on /reset-password, where the new password is set.
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetStatus(error ? "error" : "sent");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function cycleLanguage() {
    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
    setLang(next);
  }

  const pushValue = (() => {
    if (pushStatus === "enabled") return t("account.enabled");
    if (pushStatus === "loading") return t("account.enabling");
    if (pushStatus === null) return "";
    if (PUSH_ERROR_KEYS[pushStatus]) return t(PUSH_ERROR_KEYS[pushStatus]);
    if (pushStatus === "error") return t("account.pushFailed");
    return t("account.turnOn");
  })();

  return (
    <div className="space-y-6 pb-6">
      {shareNotice && (
        <div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">{shareNotice}</div>
      )}
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full bg-muted">
          {profile?.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold">{profile?.full_name || t("account.title")}</h1>
          <p className="text-sm text-muted-foreground">{profile?.email}</p>
        </div>
        {profile && <EditProfileDialog profile={profile} />}
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          <SettingsRow
            icon={ShieldCheck}
            label={t("account.twofa")}
            value={profile?.two_factor_enabled ? t("account.enabled") : t("account.notSetUp")}
          />
          <PasskeyManager />
          <SettingsRow
            icon={KeyRound}
            label={t("account.changePassword")}
            value={
              resetStatus === "sent"
                ? t("account.emailSent")
                : resetStatus === "loading"
                  ? t("common.sending")
                  : resetStatus === "error"
                    ? t("account.couldntSend")
                    : undefined
            }
            onClick={handleChangePassword}
          />
          <SettingsRow
            icon={Bell}
            label={t("account.push")}
            value={pushValue}
            onClick={pushStatus === "enabled" ? undefined : handleEnablePush}
          />
          {pushStatus === "enabled" && (
            <SettingsRow
              icon={Send}
              label={t("account.testPush")}
              value={
                testStatus === "sent"
                  ? t("account.sent")
                  : testStatus === "loading"
                    ? t("common.sending")
                    : testStatus && testStatus !== "sent"
                      ? testStatus
                      : undefined
              }
              onClick={handleSendTest}
            />
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("account.moneyControls")}
        </h2>
        <Card>
          <CardContent className="divide-y divide-border p-0">
            <AutoSaveManager />
            <DepositReminderManager />
            <WithdrawalLimitManager profile={profile} onSaved={loadProfile} />
            <SettingsRow icon={FileText} label={t("account.statements")} href="/dashboard/statement" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          <SettingsRow icon={Languages} label={t("account.language")} value={LANG_LABELS[lang]} onClick={cycleLanguage} />
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm font-medium">{t("account.appearance")}</span>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full gap-2 text-danger" onClick={handleSignOut}>
        <LogOut size={16} /> {t("account.signOut")}
      </Button>
    </div>
  );
}
