"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { supportsPlatformPasskey, describePasskeyError } from "@/lib/webauthn-support";

const PREFILL_KEY = "akiba_prefill_email";

function friendlyAuthError(error) {
  const msg = error?.message || "";
  if (error?.code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
    return "That email and password don't match. Check them and try again.";
  }
  if (error?.code === "email_not_confirmed" || /email not confirmed/i.test(msg)) {
    return "Confirm your email first — check your inbox for the link we sent.";
  }
  if (error?.status === 429 || /rate limit|too many/i.test(msg)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  return msg || "Couldn't log you in. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    supportsPlatformPasskey().then(setPasskeySupported);
  }, []);

  // Read ?exists=1 / ?reason=away straight from the URL (rather than
  // useSearchParams) so this page needs no Suspense boundary to build.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("exists") === "1") {
      setNotice("You already have an AKIBA account with that email — log in below.");
      try {
        const saved = window.sessionStorage.getItem(PREFILL_KEY);
        if (saved) setEmail(saved);
        window.sessionStorage.removeItem(PREFILL_KEY);
      } catch {
        /* nothing to prefill */
      }
    } else if (params.get("reason") === "away") {
      setNotice("You were signed out because you were away for over a minute.");
    }
  }, []);

  async function handlePasskeyLogin() {
    setError("");
    setPasskeyLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      setPasskeyLoading(false);
      if (error) {
        const message = describePasskeyError(error, { mode: "signin" });
        if (message) setError(message);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      // Belt-and-braces: never let a WebAuthn ceremony take the whole page
      // down, even if something throws instead of resolving with {error}.
      setPasskeyLoading(false);
      setError("Couldn't sign in with that passkey. Use your password instead.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (error) {
      setError(friendlyAuthError(error));
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  async function handleGoogle() {
    setError("");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (oauthError) setError(friendlyAuthError(oauthError));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <Link href="/" className="font-display text-xl font-semibold">AKIBA</Link>
        <h1 className="mt-8 font-display text-2xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Log in to see your balance and goals.</p>

        {notice && (
          <div role="status" className="mt-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          {/* Biometrics sits beside Log in, not above the form — a quick
              shortcut once you've used it before, not the headline action. */}
          <div className="flex gap-2">
            {passkeySupported && (
              <Button
                type="button"
                variant="ink"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={handlePasskeyLogin}
                disabled={passkeyLoading}
                aria-label="Sign in with biometrics"
              >
                <Fingerprint size={18} className={passkeyLoading ? "animate-pulse" : ""} />
              </Button>
            )}
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Logging in…" : "Log in"}
            </Button>
          </div>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full" onClick={handleGoogle}>
          Continue with Google
        </Button>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          New to AKIBA?{" "}
          <Link href="/register" className="font-medium text-primary">Create an account</Link>
        </p>
      </motion.div>
    </div>
  );
}
