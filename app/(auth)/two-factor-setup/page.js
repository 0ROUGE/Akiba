"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
// Secret generation + code verification happen server-side in
// /api/2fa/generate and /api/2fa/verify, so the TOTP secret is only ever
// written to `profiles.two_factor_secret` (encrypted) from trusted server
// code, never from the browser.
export default function TwoFactorSetupPage() {
  const router = useRouter();
  const [otpauthUrl, setOtpauthUrl] = useState(null);
  const [manualKey, setManualKey] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/2fa/generate", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          // Already set up - never replace a working authenticator. On to the app.
          router.replace("/dashboard");
          return;
        }
        if (!res.ok) {
          setError("Couldn't start 2FA setup. Refresh to try again.");
        } else {
          setOtpauthUrl(data.otpauth_url);
          setManualKey(data.manual_key);
        }
      } catch {
        setError("Couldn't start 2FA setup. Check your connection and refresh.");
      }
      setLoading(false);
    })();
  }, [router]);

  async function handleVerify(e) {
    e.preventDefault();
    setError("");
    setVerifying(true);
    let res;
    let data = {};
    try {
      res = await fetch("/api/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setVerifying(false);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    setVerifying(false);
    if (!res.ok || !data.verified) {
      setError(data.error || "That code didn't match. Check your app and try again.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <p className="text-sm font-medium text-primary">Step 2 of 2</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">Set up two-factor login</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Required before your first deposit. Scan this with Google Authenticator, Authy, or similar.
        </p>

        <div className="mt-6 flex flex-col items-center rounded-xl border border-border bg-card p-6">
          {loading ? (
            <div className="h-44 w-44 animate-pulse rounded-lg bg-muted" />
          ) : otpauthUrl ? (
            <QRCodeSVG value={otpauthUrl} size={176} />
          ) : (
            <p className="text-sm text-danger">{error}</p>
          )}
          {manualKey && (
            <p className="mt-4 break-all text-center text-xs text-muted-foreground">
              Can&apos;t scan? Enter manually: <span className="font-mono">{manualKey}</span>
            </p>
          )}
        </div>

        <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">6-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.5em]"
            />
          </div>

          {error && otpauthUrl && <p role="alert" className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
            {verifying ? "Verifying…" : "Verify and continue"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
