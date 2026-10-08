"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(clean, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    // Only surface rate limiting. For everything else we show the same
    // message whether or not the address has an account, so this form can't
    // be used to discover who is registered.
    if (resetError && (resetError.status === 429 || /rate limit/i.test(resetError.message || ""))) {
      setError("Too many requests. Please wait a minute and try again.");
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-semibold">AKIBA</Link>

        {sent ? (
          <div className="mt-8 space-y-3">
            <h1 className="font-display text-2xl font-semibold">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{email.trim().toLowerCase()}</span>,
              we&rsquo;ve sent a link to reset your password. It can take a minute to arrive — check spam too.
            </p>
            <Link href="/login" className="inline-block text-sm font-medium text-primary">Back to log in</Link>
          </div>
        ) : (
          <>
            <h1 className="mt-8 font-display text-2xl font-semibold">Reset your password</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your email and we&rsquo;ll send you a reset link.</p>
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required autoComplete="email" disabled={loading}
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Remembered it? <Link href="/login" className="font-medium text-primary">Log in</Link>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
