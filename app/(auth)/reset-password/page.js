"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// "checking" → waiting for the recovery link to be exchanged for a session,
// "ready" → show the form, "invalid" → link expired / already used.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The browser client turns the ?code= in the email link into a session
    // on load. Listen for it, and also check once in case it already happened.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancelled && session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        setStatus("ready");
      }
    });

    const timer = setTimeout(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled) setStatus(session ? "ready" : "invalid");
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Your password needs at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(
        updateError.code === "same_password"
          ? "Choose a password you haven't used before."
          : updateError.code === "weak_password"
            ? "That password is too weak. Try a longer one with a mix of letters and numbers."
            : updateError.message
      );
      return;
    }
    // Sign out everywhere so any session that knew the old password is gone,
    // then make them log in with the new one (which also re-triggers 2FA).
    await supabase.auth.signOut();
    router.replace("/login?reset=1");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-semibold">AKIBA</Link>

        {status === "checking" && <p className="mt-8 text-sm text-muted-foreground">Checking your reset link…</p>}

        {status === "invalid" && (
          <div className="mt-8 space-y-3">
            <h1 className="font-display text-2xl font-semibold">This link has expired</h1>
            <p className="text-sm text-muted-foreground">
              Reset links work once and expire after a short time. Request a new one and try again.
            </p>
            <Button className="w-full" onClick={() => router.replace("/forgot-password")}>Request a new link</Button>
          </div>
        )}

        {status === "ready" && (
          <>
            <h1 className="mt-8 font-display text-2xl font-semibold">Choose a new password</h1>
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" disabled={loading}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" type="password" required minLength={8} autoComplete="new-password" disabled={loading}
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
