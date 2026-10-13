"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function Verify2FAPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function handleSubmit(e) {
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
      // The server says how many tries are left, or how long the lock lasts.
      setError(data.error || "That code didn't match. Check your app and try again.");
      setCode("");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <span className="font-display text-xl font-semibold">AKIBA</span>
        <h1 className="mt-8 font-display text-2xl font-semibold">Enter your 2FA code</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open your authenticator app to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">6-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.5em]"
            />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
