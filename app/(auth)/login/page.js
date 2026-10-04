"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { supportsPlatformPasskey } from "@/lib/webauthn-support";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    supportsPlatformPasskey().then(setPasskeySupported);
  }, []);

  async function handlePasskeyLogin() {
    setError("");
    setPasskeyLoading(true);
    const { error } = await supabase.auth.signInWithPasskey();
    setPasskeyLoading(false);
    if (error) {
      if (!error.message?.toLowerCase().includes("cancel")) {
        setError("Couldn't sign in with that passkey. Use your password instead.");
      }
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
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

        {passkeySupported && (
          <>
            <Button
              variant="ink"
              className="mt-8 w-full gap-2"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
            >
              <Fingerprint size={18} />
              {passkeyLoading ? "Check your device…" : "Sign in with biometrics"}
            </Button>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or use your password <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className={passkeySupported ? "space-y-4" : "mt-8 space-y-4"}>
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

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Logging in…" : "Log in"}
          </Button>
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
