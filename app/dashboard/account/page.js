"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, ShieldCheck, KeyRound, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush } from "@/lib/push";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AccountPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [pushStatus, setPushStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);

  async function handleEnablePush() {
    setPushStatus("loading");
    try {
      await subscribeToPush();
      setPushStatus("enabled");
    } catch {
      setPushStatus("error");
    }
  }

  async function handleChangePassword() {
    if (!profile?.email) return;
    setResetStatus("loading");
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setResetStatus(error ? "error" : "sent");
  }

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile({ ...data, email: user.email });
    })();
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full bg-muted">
          {profile?.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold">{profile?.full_name || "Your account"}</h1>
          <p className="text-sm text-muted-foreground">{profile?.email}</p>
        </div>
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
            value={pushStatus === "enabled" ? "Enabled" : pushStatus === "loading" ? "Enabling…" : pushStatus === "error" ? "Couldn't enable" : "Turn on"}
            onClick={handleEnablePush}
          />
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
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-4 text-left">
      <Icon size={18} className="text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {value && <span className="text-sm text-muted-foreground">{value}</span>}
      <ChevronRight size={16} className="text-muted-foreground" />
    </button>
  );
}
