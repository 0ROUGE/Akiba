"use client";

import { useEffect, useState } from "react";
import { Loader2, Fingerprint } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/sheet";
import { supportsPlatformPasskey, describePasskeyError } from "@/lib/webauthn-support";

const digits = (v) => v.replace(/\D/g, "").slice(0, 6);
const PIN_CLASS = "text-center text-lg tracking-[0.5em]";

async function post(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch {
    return { res: null, data: {} };
  }
}

// Re-confirm it's really the account owner before money leaves.
//   mode "verify": enter the withdrawal PIN, or tap the fingerprint for a biometric check
//   mode "set":    create (needs an authenticator code) or change (needs the current PIN) the PIN
// Calls onDone() once the server has accepted it (it sets a short-lived signed cookie).
export function StepUpDialog({ open, mode = "verify", hasPin = true, onClose, onDone }) {
  const supabase = createClient();
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [code, setCode] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioOk, setBioOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setNewPin("");
    setConfirmPin("");
    setCode("");
    setUseCode(false);
    setError("");
    setBusy(false);
  }, [open]);

  useEffect(() => {
    supportsPlatformPasskey()
      .then(setBioOk)
      .catch(() => setBioOk(false));
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    const { res, data } = await post("/api/step-up/pin", { action: "verify", pin });
    setBusy(false);
    if (!res) {
      setError("Couldn't reach the server. Check your connection.");
      return;
    }
    if (res.ok && data.verified) {
      onDone();
      return;
    }
    setPin("");
    setError(data.error || "That PIN didn't match.");
  }

  async function handleBiometric() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const { error: pkError } = await supabase.auth.signInWithPasskey();
      if (pkError) {
        const message = describePasskeyError(pkError, { mode: "signin" });
        if (message) setError(message);
        return;
      }
      const { res, data } = await post("/api/step-up/passkey");
      if (res?.ok && data.verified) {
        onDone();
        return;
      }
      setError(data.error || "Biometric check wasn't accepted — use your PIN instead.");
    } catch {
      setError("Couldn't use biometrics. Use your PIN instead.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSet(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!/^\d{4,6}$/.test(newPin)) {
      setError("Use 4 to 6 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("The two PINs don't match.");
      return;
    }
    const payload = { action: "set", newPin };
    if (hasPin && !useCode) payload.currentPin = pin;
    else payload.code = code;

    setBusy(true);
    const { res, data } = await post("/api/step-up/pin", payload);
    setBusy(false);
    if (!res) {
      setError("Couldn't reach the server. Check your connection.");
      return;
    }
    if (res.ok && data.saved) {
      onDone();
      return;
    }
    setError(data.error || "Couldn't save your PIN.");
  }

  const spinner = <Loader2 size={16} className="animate-spin" />;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "set" ? (hasPin ? "Change withdrawal PIN" : "Set a withdrawal PIN") : "Confirm it's you"}
    >
      {mode === "verify" ? (
        <form onSubmit={handleVerify} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">Enter your withdrawal PIN to continue.</p>
          <div className="space-y-1.5">
            <Label htmlFor="stepup-pin">Withdrawal PIN</Label>
            <Input
              id="stepup-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
              className={PIN_CLASS}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full gap-2" disabled={busy || pin.length < 4}>
            {busy ? spinner : null} Confirm
          </Button>
          {bioOk && (
            <Button type="button" variant="outline" className="w-full gap-2" onClick={handleBiometric} disabled={busy}>
              <Fingerprint size={16} /> Use biometrics instead
            </Button>
          )}
        </form>
      ) : (
        <form onSubmit={handleSet} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            {hasPin
              ? "Choose a new 4–6 digit PIN."
              : "Withdrawals need a PIN. Pick 4–6 digits you'll remember — avoid birthdays and simple sequences."}
          </p>
          {hasPin && !useCode && (
            <div className="space-y-1.5">
              <Label htmlFor="stepup-current">Current PIN</Label>
              <Input
                id="stepup-current"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(digits(e.target.value))}
                className={PIN_CLASS}
              />
              <button type="button" className="text-xs font-medium text-primary" onClick={() => setUseCode(true)}>
                Forgot it? Use an authenticator code instead
              </button>
            </div>
          )}
          {(!hasPin || useCode) && (
            <div className="space-y-1.5">
              <Label htmlFor="stepup-code">Authenticator code</Label>
              <Input
                id="stepup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(digits(e.target.value))}
                className={PIN_CLASS}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="stepup-new">New PIN</Label>
            <Input
              id="stepup-new"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(digits(e.target.value))}
              className={PIN_CLASS}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stepup-confirm">Confirm new PIN</Label>
            <Input
              id="stepup-confirm"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(digits(e.target.value))}
              className={PIN_CLASS}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full gap-2" disabled={busy}>
            {busy ? spinner : null} Save PIN
          </Button>
        </form>
      )}
    </Sheet>
  );
}
