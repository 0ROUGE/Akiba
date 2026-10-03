"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, ShieldCheck, KeyRound, Bell, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush } from "@/lib/push";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { EditProfileDialog } from "@/components/edit-profile-dialog";

const PUSH_ERROR_MESSAGES = {
  unsupported: "Not supported in this browser",
  "permission-denied": "Blocked — check your browser's site settings",
  "missing-vapid-key": "Not configured yet",
};

export default function AccountPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [pushStatus, setPushStatus] = useState(null); // null | "checking" | "enabled" | "off" | "loading" | error key
  const [testStatus, setTestStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile({ ...data, email: user.email });
    })();

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
  }, [supabase]);

  async function handleEnablePush() {
    setPushStatus("loading");
    try {
      await subscribeToPush();
      setPushStatus("enabled");
    } catch (err) {
      setPushStatus(PUSH_ERROR_MESSAGES[err.message] ? err.message : "error");
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
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setResetStatus(error ? "error" : "sent");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const pushValue = (() => {
    if (pushStatus === "enabled") return "Enabled";
    if (pushStatus === "loading") return "Enabling…";
    if (pushStatus === "checking" || pushStatus === null) return "";
    if (PUSH_ERROR_MESSAGES[pushStatus]) return PUSH_ERROR_MESSAGES[pushStatus];
    if (pushStatus === "error") return "Couldn't enable";
    return "Turn on";
  })();

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full bg-muted">
          {profile?.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold">{profile?.full_name || "Your account"}</h1>
          <p className="text-sm text-muted-foreground">{profile?.email}</p>
        </div>
        {profile && <EditProfileDialog profile={profile} />}
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          <Row icon={ShieldCheck} label="Two-factor authentication" value={profile?.two_factor_enabled ? "Enabled" : "Not set up"} />
          <Row
            icon={KeyRound}
            label="Change password"
            value={resetStatus === "sent" ? "Email sent" : resetStatus === "loading" ? "Sending…" : resetStatus === "error" ? "Couldn't send" : undefined}
            onClick={handleChangePassword}
          />
          <Row
            icon={Bell}
            label="Push notifications"
            value={pushValue}
            onClick={pushStatus === "enabled" ? undefined : handleEnablePush}
          />
          {pushStatus === "enabled" && (
            <Row
              icon={Send}
              label="Send test notification"
              value={testStatus === "sent" ? "Sent!" : testStatus === "loading" ? "Sending…" : testStatus && testStatus !== "sent" ? testStatus : undefined}
              onClick={handleSendTest}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <span className="text-sm font-medium">Appearance</span>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full gap-2 text-danger" onClick={handleSignOut}>
        <LogOut size={16} /> Sign out
      </Button>
    </div>
  );
}

function Row({ icon: Icon, label, value, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 px-5 py-4 text-left disabled:cursor-default">
      <Icon size={18} className="text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {value && <span className="text-sm text-muted-foreground">{value}</span>}
      {onClick && <ChevronRight size={16} className="text-muted-foreground" />}
    </button>
  );
}
