"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Smartphone, X, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ReceiptActions } from "@/components/receipt-actions";
import { buildReceipt } from "@/lib/receipt";
import { formatKES } from "@/lib/utils";
import { enqueueRequest, registerBackgroundSync } from "@/lib/offline-queue";

// The deposit journey: amount -> "check your phone" (spinner) -> automatic
// success screen with receipt download/share. The database row is the source
// of truth; localStorage only remembers WHICH deposit we're tracking, so a
// refresh (or reopening the tab) drops the user straight back into the right
// screen - waiting, success or failed.

const STORAGE_KEY = "akiba_active_deposit";
const MAX_AGE_MS = 30 * 60 * 1000; // stop resuming anything older than this
const MAX_DEPOSIT = 250_000; // M-Pesa single-transaction ceiling
const POLL_MS = 3000;
const SLOW_AFTER_MS = 90_000;
const FIRST_STATUS_CHECK_MS = 12_000;
const STATUS_CHECK_EVERY_MS = 12_000;
const STATUS_CHECK_UNTIL_MS = 5 * 60 * 1000;
const TX_COLUMNS = "id, type, amount, mpesa_receipt_number, mpesa_transaction_status, description, created_at";

function readActive() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.id || !Number.isFinite(v.startedAt) || Date.now() - v.startedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
function writeActive(v) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked - the flow still works, it just won't survive a refresh */
  }
}
function clearActive() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function friendlyReason(description) {
  const d = String(description || "");
  if (/cancel/i.test(d)) return "You cancelled the request on your phone.";
  if (/insufficient/i.test(d)) return "Your M-Pesa balance was too low for this deposit.";
  if (/timeout|timed out|cannot be reached/i.test(d)) return "The prompt timed out before it was approved.";
  if (/wrong pin|initiator information is invalid/i.test(d)) return "The M-Pesa PIN entered was wrong.";
  return "M-Pesa couldn't complete this deposit.";
}

export function DepositFlow({ open, onClose, onResume, onSettled }) {
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [phase, setPhase] = useState("form"); // form | waiting | slow | success | failed
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null); // { id, amount, startedAt }
  const [row, setRow] = useState(null); // confirmed ledger row
  const [failReason, setFailReason] = useState("");

  // Latest callbacks without re-running effects.
  const cb = useRef({ onResume, onSettled });
  cb.current = { onResume, onSettled };

  async function fetchTx(id) {
    const { data } = await supabase
      .from("ledger_transactions")
      .select(TX_COLUMNS)
      .eq("id", id)
      .eq("type", "deposit")
      .maybeSingle();
    return data ?? null;
  }

  function applyRow(t) {
    if (t.mpesa_transaction_status === "confirmed") {
      setRow(t);
      setPhase("success");
      cb.current.onSettled?.();
    } else if (t.mpesa_transaction_status === "failed") {
      setFailReason(friendlyReason(t.description));
      setPhase("failed");
      cb.current.onSettled?.();
    } else {
      setPhase((p) => (p === "slow" ? "slow" : "waiting"));
    }
  }

  // Resume after a refresh / reopened tab.
  useEffect(() => {
    const saved = readActive();
    if (!saved) return undefined;
    let cancelled = false;
    (async () => {
      let t = null;
      try {
        t = await fetchTx(saved.id);
      } catch {
        /* offline - leave the saved marker for next time */
        return;
      }
      if (cancelled) return;
      if (!t) {
        clearActive();
        return;
      }
      setActive(saved);
      applyRow(t);
      cb.current.onResume?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While waiting: poll the row, and nudge Safaricom directly if the callback is late.
  useEffect(() => {
    if (!active || (phase !== "waiting" && phase !== "slow")) return undefined;
    let stopped = false;
    let inFlight = false;
    let lastStatusCheck = 0;

    async function tick() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        let t = await fetchTx(active.id);
        if (stopped) return;
        if (t && t.mpesa_transaction_status !== "pending") return applyRow(t);

        const elapsed = Date.now() - active.startedAt;
        if (elapsed > SLOW_AFTER_MS) setPhase((p) => (p === "waiting" ? "slow" : p));
        if (
          elapsed >= FIRST_STATUS_CHECK_MS &&
          elapsed <= STATUS_CHECK_UNTIL_MS &&
          Date.now() - lastStatusCheck >= STATUS_CHECK_EVERY_MS
        ) {
          lastStatusCheck = Date.now();
          await fetch("/api/mpesa/stk-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactionId: active.id }),
          }).catch(() => {});
          t = await fetchTx(active.id);
          if (!stopped && t && t.mpesa_transaction_status !== "pending") applyRow(t);
        }
      } catch {
        /* transient network error - next tick retries */
      } finally {
        inFlight = false;
      }
    }

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase]);

  const receipt = useMemo(() => (row ? buildReceipt(row, formatKES) : null), [row]);

  function reset() {
    clearActive();
    setActive(null);
    setRow(null);
    setFailReason("");
    setError("");
    setPhase("form");
  }

  function close() {
    reset();
    setAmount("");
    onClose?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 1 || value > MAX_DEPOSIT) {
      setError(`Enter a whole amount from KES 1 to KES ${MAX_DEPOSIT.toLocaleString("en-KE")}.`);
      return;
    }

    setBusy(true);
    let res;
    let data;
    try {
      res = await fetch("/api/mpesa/stk-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      // No connection at all: queue it and let Background Sync send it later.
      enqueueRequest({ endpoint: "/api/mpesa/stk-push", body: { amount: value } });
      await registerBackgroundSync();
      setBusy(false);
      setError("You're offline — this will be sent automatically once you're back online.");
      return;
    }
    setBusy(false);

    if (!res.ok || !data.transactionId) {
      setError(data.error || "Couldn't reach M-Pesa right now. Try again shortly.");
      return;
    }
    const a = { id: data.transactionId, amount: value, startedAt: Date.now() };
    writeActive(a);
    setActive(a);
    setPhase("waiting");
  }

  async function checkAgain() {
    if (!active) return;
    try {
      await fetch("/api/mpesa/stk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: active.id }),
      });
      const t = await fetchTx(active.id);
      if (t) applyRow(t);
    } catch {
      /* the poller keeps going */
    }
  }

  const waiting = phase === "waiting" || phase === "slow";
  const title =
    phase === "success" ? "Deposit received" : phase === "failed" ? "Deposit didn't go through" : waiting ? "Approve on your phone" : "Deposit";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Don't let a stray tap dismiss the waiting or success screens.
          onClick={() => {
            if (phase === "form" || phase === "failed") close();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-medium">{title}</h3>
              <button onClick={close} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {phase === "form" && (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="deposit-amount">Amount (KES)</Label>
                  <Input
                    id="deposit-amount"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full gap-2" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Sending…
                    </>
                  ) : (
                    "Send M-Pesa prompt"
                  )}
                </Button>
              </form>
            )}

            {waiting && active && (
              <div className="space-y-5" aria-live="polite">
                <div className="flex flex-col items-center gap-4 py-2 text-center">
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <Loader2 size={80} strokeWidth={1.25} className="animate-spin text-primary" />
                    <Smartphone size={26} className="absolute text-primary" />
                  </div>
                  <div>
                    <p className="font-display text-lg font-medium">
                      {phase === "slow" ? "Still waiting for M-Pesa" : "Check your phone"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {phase === "slow"
                        ? "If you've already approved, it can take a moment to arrive. We'll update this screen automatically."
                        : `Enter your M-Pesa PIN to approve ${formatKES(active.amount)}. This screen updates by itself once it's confirmed.`}
                    </p>
                  </div>
                </div>
                {phase === "slow" && (
                  <div className="space-y-2">
                    <Button className="w-full" onClick={checkAgain}>
                      Check again
                    </Button>
                    <Button variant="outline" className="w-full" onClick={close}>
                      Close — I&rsquo;ll find it in my history
                    </Button>
                  </div>
                )}
              </div>
            )}

            {phase === "success" && row && receipt && (
              <div className="space-y-5" aria-live="polite">
                <div className="flex flex-col items-center gap-2 text-center">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  >
                    <CheckCircle2 size={56} className="text-success" />
                  </motion.div>
                  <p className="font-display text-3xl font-semibold tabular-nums">{receipt.amount}</p>
                  <p className="text-sm text-muted-foreground">has been added to your AKIBA balance.</p>
                </div>
                <ReceiptActions receipt={receipt} compact />
                <Link
                  href={`/dashboard/receipt/${row.id}`}
                  className="block text-center text-sm font-medium text-primary"
                >
                  View full receipt
                </Link>
                <Button className="w-full" onClick={close}>
                  Done
                </Button>
              </div>
            )}

            {phase === "failed" && (
              <div className="space-y-5" aria-live="polite">
                <div className="flex flex-col items-center gap-2 text-center">
                  <XCircle size={56} className="text-danger" />
                  <p className="text-sm text-muted-foreground">{failReason} No money was taken.</p>
                </div>
                <Button className="w-full" onClick={reset}>
                  Try again
                </Button>
                <Button variant="outline" className="w-full" onClick={close}>
                  Close
                </Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
