"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { supportsPlatformPasskey } from "@/lib/webauthn-support";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

// Lets a signed-in user register this device's biometrics (Face ID / Touch
// ID / fingerprint / Windows Hello) as a passkey, and manage the ones
// they've already added. Built on Supabase Auth's beta Passkeys API —
// straight WebAuthn under the hood, nothing custom-rolled.
export function PasskeyManager() {
  const supabase = createClient();
  const [supported, setSupported] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");

  async function loadPasskeys() {
    const { data, error } = await supabase.auth.passkey.list();
    if (!error) setPasskeys(data || []);
  }

  useEffect(() => {
    supportsPlatformPasskey().then(setSupported);
    loadPasskeys();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRegister() {
    setError("");
    setRegistering(true);
    const { error } = await supabase.auth.registerPasskey();
    setRegistering(false);
    if (error) {
      setError(
        error.message?.includes("cancel")
          ? "Cancelled."
          : "Couldn't register this device. Make sure biometrics/screen lock is set up on it."
      );
      return;
    }
    await loadPasskeys();
  }

  async function handleDelete(passkeyId) {
    await supabase.auth.passkey.delete({ passkeyId });
    setPasskeys((prev) => prev.filter((p) => p.id !== passkeyId));
  }

  if (supported === false && passkeys.length === 0) {
    return (
      <div className="px-5 py-4 text-sm text-muted-foreground">
        Biometric sign-in isn&apos;t available on this device/browser.
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Fingerprint size={18} className="text-muted-foreground" />
          <span className="text-sm font-medium">Biometric sign-in</span>
        </div>
        {supported !== false && (
          <Button size="sm" variant="outline" onClick={handleRegister} disabled={registering}>
            {registering ? "Check your device…" : "Add this device"}
          </Button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {passkeys.length > 0 && (
        <ul className="mt-3 space-y-2">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span>
                {p.friendly_name || "Unnamed device"}
                <span className="ml-2 text-xs text-muted-foreground">
                  added {formatDate(p.created_at)}
                </span>
              </span>
              <button onClick={() => handleDelete(p.id)} aria-label="Remove passkey">
                <Trash2 size={15} className="text-muted-foreground hover:text-danger" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
