"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { SettingsRow } from "@/components/settings-row";
import { StepUpDialog } from "@/components/step-up-dialog";

// Account row to create or change the PIN that guards withdrawals and payout plans.
export function WithdrawalPinManager() {
  const [hasPin, setHasPin] = useState(null); // null = still loading / unknown
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/step-up/pin")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setHasPin(Boolean(d.hasPin));
      })
      .catch(() => {
        if (alive) setHasPin(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <SettingsRow
        icon={Lock}
        label="Withdrawal PIN"
        value={hasPin === null ? "" : hasPin ? "On" : "Set up"}
        onClick={() => setOpen(true)}
      />
      <StepUpDialog
        open={open}
        mode="set"
        hasPin={Boolean(hasPin)}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          setHasPin(true);
        }}
      />
    </>
  );
}
