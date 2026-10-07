"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { createClient } from "@/lib/supabase/client";
import { isValidKenyanMobile, toE164 } from "@/lib/phone";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PREFILL_KEY = "akiba_prefill_email";

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ email: "", password: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [existingEmail, setExistingEmail] = useState(null); // set when this email already has an account
  const [checkEmail, setCheckEmail] = useState(false); // set when email confirmation is required

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function goToLogin(email) {
    try {
      // sessionStorage instead of a ?email= param so the address never lands in URLs/history/logs.
      window.sessionStorage.setItem(PREFILL_KEY, email);
    } catch {
      /* the login page just won't be prefilled */
    }
    router.replace("/login?exists=1");
  }

  // An email that's already registered is a *login*, not a signup: tell the
  // person, then take them to the login form with their email filled in.
  useEffect(() => {
    if (!existingEmail) return;
    const t = setTimeout(() => goToLogin(existingEmail), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingEmail]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const email = form.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!isValidKenyanMobile(form.phone)) {
      setError("Enter a valid Kenyan mobile number — 9 digits after +254, starting with 7 or 1.");
      return;
    }
    if (form.password.length < 8) {
      setError("Your password needs at least 8 characters.");
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: { data: { phone: toE164(form.phone) } },
    });
    setLoading(false);

    if (signUpError) {
      if (signUpError.code === "user_already_exists" || /already (been )?registered/i.test(signUpError.message || "")) {
        setExistingEmail(email);
        return;
      }
      if (signUpError.status === 429 || /rate limit/i.test(signUpError.message || "")) {
        setError("Too many attempts. Please wait a minute and try again.");
        return;
      }
      setError(signUpError.message);
      return;
    }

    // With email confirmation on, Supabase deliberately does NOT return an
    // error for an address that already exists (anti-enumeration) — it returns
    // a placeholder user whose `identities` list is empty. That's the signal.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setExistingEmail(email);
      return;
    }

    // No session means the project requires email confirmation first.
    if (!data?.session) {
      setCheckEmail(true);
      return;
    }

    router.replace("/profile-setup");
  }

  async function handleGoogle() {
    setError("");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/profile-setup` },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <Link href="/" className="font-display text-xl font-semibold">AKIBA</Link>

        {checkEmail ? (
          <div className="mt-8 space-y-3">
            <h1 className="font-display text-2xl font-semibold">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{form.email.trim().toLowerCase()}</span>.
              Open it to finish creating your account, then log in.
            </p>
            <Button className="w-full" onClick={() => router.replace("/login")}>Go to log in</Button>
          </div>
        ) : (
          <>
            <h1 className="mt-8 font-display text-2xl font-semibold">Create your account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your phone number is what deposits and withdrawals move through.
            </p>

            {existingEmail && (
              <div role="status" className="mt-6 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
                <p className="font-medium">You already have an AKIBA account with this email.</p>
                <p className="mt-1 text-muted-foreground">
                  Taking you to log in… If you originally signed up with Google, use “Continue with Google” there.
                </p>
                <Button className="mt-3 w-full" onClick={() => goToLogin(existingEmail)}>Log in now</Button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required autoComplete="email" disabled={loading}
                  value={form.email} onChange={update("email")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">M-Pesa phone number</Label>
                <PhoneInput id="phone" required disabled={loading}
                  value={form.phone} onChange={(national) => setForm((f) => ({ ...f, phone: national }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" disabled={loading}
                  value={form.password} onChange={update("password")} />
              </div>

              {error && <p role="alert" className="text-sm text-danger">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account…" : "Create account"}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>

            <Button variant="outline" className="w-full" onClick={handleGoogle}>
              Continue with Google
            </Button>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary">Log in</Link>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
