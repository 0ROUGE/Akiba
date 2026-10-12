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

// One M-Pesa journey, used for both deposits and withdrawals so they look and
// behave identically: amount -> spinner -> automatic success screen with receipt
// download/share. The database row is the source of truth; localStorage only
// remembers WHICH transaction we're tracking, so a refresh (or reopening the tab)
// drops the user straight back into the right screen.

const MAX_AMOUNT = 250_000; // M-Pesa single-transaction ceiling
const MAX_AGE_MS = 30 * 60 * 1000; // stop resuming anything older than this
const POLL_MS = 3000;
const SLOW_AFTER_MS = 90_000;
const STATUS_CHECK_UNTIL_MS = 5 * 60 * 1000;
const TX_COLUMNS = "id, type, amount, mpesa_receipt_number, mpesa_transaction_status, description, created_at";

const CONFIGS = {
  deposit: {
    storageKey: "akiba_active_deposit",
    startUrl: "/api/mpesa/stk-push",
    statusUrl: "/api/mpesa/stk-status",
    txType: "deposit",
    queueOffline: true,
    firstStatusCheckMs: 12_000, // Safaricom is only asked if the callback is late
    statusEveryMs: 12_000,
    titles: {
      form: "Deposit",
      waiting: "Approve on your phone",
      success: "Deposit received",
      failed: "Deposit didn't go through",
    },
    submitLabel: "Send M-Pesa prompt",
    waitingHeading: "Check your phone",
    waitingBody: (amt) =>
      `Enter your M-Pesa PIN to approve ${amt}. This screen updates by itself once it's confirmed.`,
    slowBody: "If you've already approved, it can take a moment to arrive. We'll update this screen automatically.",
    successLine: "has been added to your AKIBA balance.",
    failedTail: "No money was taken.",
  },
  withdrawal: {
    storageKey: "akiba_active_withdrawal",
    startUrl: "/api/mpesa/b2c",
    statusUrl: "/api/mpesa/b2c-status",
    txType: "withdrawal",
    queueOffline: false, // money only leaves on a request the user sees go through
    firstStatusCheckMs: 3000,
    statusEveryMs: 5000,
    titles: {
      form: "Withdraw",
      waiting: "Sending to your phone",
      success: "Withdrawal sent",
      failed: "Withdrawal didn't go through",
    },
    submitLabel: "Request withdrawal",
    waitingHeading: "Sending to your phone",
    waitingBody: (amt) =>
      `M-Pesa is processing your ${amt} withdrawal. This screen updates by itself once it's done.`,
    slowBody: "M-Pesa is taking longer than usual. Your AKIBA balance only drops once it's confirmed.",
    successLine: "is on its way to your phone.",
    failedTail: "Your AKIBA balance wasn't changed.",
  },
};

function makeStore(key) {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (!v?.id || !Number.isFinite(v.startedAt) || Date.now() - v.startedAt > MAX_AGE_MS) {
          localStorage.removeItem(key);
          return null;
        }
        return v;
      } catch {
        return null;
      }
    },
    write(v) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage blocked - the flow still works, it just won't survive a refresh */
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
const STORES = {
  deposit: makeStore(CONFIGS.deposit.storageKey),
  withdrawal: makeStore(CONFIGS.withdrawal.storageKey),
};

function friendlyReason(description, kind) {
  const d = String(description || "");
  if (/cancel/i.test(d)) return "You cancelled the request on your phone.";
  if (/timeout|timed out|took too long|cannot be reached/i.test(d)) {
    return kind === "deposit" ? "The prompt timed out before it was approved." : "M-Pesa took too long to respond.";
  }
  if (kind === "deposit") {
    if (/insufficient/i.test(d)) return "Your M-Pesa balance was too low for this deposit.";
    if (/wrong pin|initiator information is invalid/i.test(d)) return "The M-Pesa PIN entered was wrong.";
    return "M-Pesa couldn't complete this deposit.";
  }
  if (/credit party customer type/i.test(d)) return "M-Pesa couldn't pay out to this number.";
  return "M-Pesa couldn't complete this withdrawal right now.";
}

export function MpesaFlow({ kind, open, onClose, onResume, onSettled, onNeedStepUp, available }) {
  const cfg = CONFIGS[kind];
  const store = STORES[kind];

  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [phase, setPhase] = useState("form"); // form | waiting | slow | success | failed
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null); // { id, amount, startedAt, simulated? }
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
      .eq("type", cfg.txType)
      .maybeSingle();
    return data ?? null;
  }

  function applyRow(t) {
    if (t.mpesa_transaction_status === "confirmed") {
      setRow(t);
      setPhase("success");
      cb.current.onSettled?.();
    } else if (t.mpesa_transaction_status === "failed") {
      setFailReason(friendlyReason(t.description, kind));
      setPhase("failed");
      cb.current.onSettled?.();
    } else {
      setPhase((p) => (p === "slow" ? "slow" : "waiting"));
    }
  }

  // Resume after a refresh / reopened tab.
  useEffect(() => {
    const saved = store.read();
    if (!saved) return undefined;
    let cancelled = false;
    (async () => {
      let t = null;
      try {
        t = await fetchTx(saved.id);
      } catch {
        return; // offline - leave the saved marker for next time
      }
      if (cancelled) return;
      if (!t) {
        store.clear();
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

  async function nudgeStatus(id) {
    await fetch(cfg.statusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: id }),
    }).catch(() => {});
  }

  // While waiting: poll the row, and nudge the server if the callback is late.
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
        if (t && t.mpesa_transaction_status !== "pending") {
          applyRow(t);
          return;
        }

        const elapsed = Date.now() - active.startedAt;
        if (elapsed > SLOW_AFTER_MS) setPhase((p) => (p === "waiting" ? "slow" : p));
        if (
          elapsed >= cfg.firstStatusCheckMs &&
          elapsed <= STATUS_CHECK_UNTIL_MS &&
          Date.now() - lastStatusCheck >= cfg.statusEveryMs
        ) {
          lastStatusCheck = Date.now();
          await nudgeStatus(active.id);
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
  const simulated = Boolean(active?.simulated) || /^sandbox/i.test(row?.description || "");

  function reset() {
    store.clear();
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

  async function submit(value) {
    setBusy(true);
    let res;
    let data;
    try {
      res = await fetch(cfg.startUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setBusy(false);
      if (cfg.queueOffline) {
        // No connection at all: queue it and let Background Sync send it later.
        enqueueRequest({ endpoint: cfg.startUrl, body: { amount: value } });
        await registerBackgroundSync();
        setError("You're offline — this will be sent automatically once you're back online.");
      } else {
        setError("You're offline. Connect to the internet and try again.");
      }
      return;
    }
    setBusy(false);

    if (!res.ok || !data.transactionId) {
      if (onNeedStepUp && (data.code === "STEP_UP_REQUIRED" || data.code === "PIN_REQUIRED")) {
        onNeedStepUp(data.code, () => submit(value));
        return;
      }
      setError(data.error || "Couldn't reach M-Pesa right now. Try again shortly.");
      return;
    }
    const a = { id: data.transactionId, amount: value, startedAt: Date.now(), simulated: Boolean(data.simulated) };
    store.write(a);
    setActive(a);
    setPhase("waiting");
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 1 || value > MAX_AMOUNT) {
      setError(`Enter a whole amount from KES 1 to KES ${MAX_AMOUNT.toLocaleString("en-KE")}.`);
      return;
    }
    if (kind === "withdrawal" && typeof available === "number" && value > available) {
      setError("That's more than your AKIBA balance.");
      return;
    }
    submit(value);
  }

  async function checkAgain() {
    if (!active) return;
    await nudgeStatus(active.id);
    try {
      const t = await fetchTx(active.id);
      if (t) applyRow(t);
    } catch {
      /* the poller keeps going */
    }
  }

  const waiting = phase === "waiting" || phase === "slow";
  const title = phase === "success" ? cfg.titles.success : phase === "failed" ? cfg.titles.failed : waiting ? cfg.titles.waiting : cfg.titles.form;

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
                  <Label htmlFor={`${kind}-amount`}>Amount (KES)</Label>
                  <Input
                    id={`${kind}-amount`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  {kind === "withdrawal" && typeof available === "number" && (
                    <p className="text-xs text-muted-foreground">Available: {formatKES(available)}</p>
                  )}
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
                    cfg.submitLabel
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
                      {phase === "slow" ? "Still waiting for M-Pesa" : cfg.waitingHeading}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {phase === "slow" ? cfg.slowBody : cfg.waitingBody(formatKES(active.amount))}
                    </p>
                  </div>
                  {simulated && (
                    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      Sandbox mode — this payout is simulated, so no real money is sent.
                    </p>
                  )}
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
                  <p className="text-sm text-muted-foreground">{cfg.successLine}</p>
                  {simulated && (
                    <p className="mt-1 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      Sandbox mode — simulated payout, no real money was sent.
                    </p>
                  )}
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
                  <p className="text-sm text-muted-foreground">
                    {failReason} {cfg.failedTail}
                  </p>
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
