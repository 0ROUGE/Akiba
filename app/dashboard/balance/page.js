"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { TransactionRow } from "@/components/transaction-row";
import { formatKES } from "@/lib/utils";
import { enqueueRequest, registerBackgroundSync } from "@/lib/offline-queue";

// STK Push / B2C initiation happen server-side in /api/mpesa/stk-push and
// /api/mpesa/b2c. This page calls them and then relies on realtime to
// reflect the confirmed/failed state once Safaricom's callback lands — it
// never marks a transaction successful on its own.
export default function BalancePage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [modal, setModal] = useState(null); // "deposit" | "withdraw" | null
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Fetches data only — never touches the realtime channel, so calling this
  // on every change event can't multiply subscriptions (that was the bug:
  // the old version re-subscribed on every update, leaking a channel each
  // time and making the page progressively slower the longer it stayed open).
  const loadData = useCallback(
    async (userId) => {
      const [{ data: balanceRow }, { data: txs }] = await Promise.all([
        supabase.from("akiba_balances").select("balance").eq("user_id", userId).maybeSingle(),
        supabase
          .from("ledger_transactions")
          .select("*")
          .eq("user_id", userId)
          .in("type", ["deposit", "withdrawal"])
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      setBalance(balanceRow?.balance ?? 0);
      setTransactions(txs ?? []);
    },
    [supabase]
  );

  useEffect(() => {
    let channel;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      await loadData(user.id);

      channel = supabase
        .channel(`balance-updates-${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "ledger_transactions", filter: `user_id=eq.${user.id}` },
          () => loadData(user.id)
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, loadData]);

  // Opens the right modal straight away when linked to with ?action=deposit
  // or ?action=withdraw — used by the dashboard quick actions and by the
  // web+akiba: protocol handler.
  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "deposit" || action === "withdraw") setModal(action);
  }, [searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    const endpoint = modal === "deposit" ? "/api/mpesa/stk-push" : "/api/mpesa/b2c";
    const body = { amount: Number(amount) };

    let res, data;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      // No network at all (not a server error) — queue it for Background
      // Sync to retry automatically the moment connectivity returns.
      enqueueRequest({ endpoint, body });
      await registerBackgroundSync();
      setSubmitting(false);
      setFeedback({
        type: "error",
        text: "You're offline — this will be sent automatically once you're back online.",
      });
      return;
    }

    setSubmitting(false);
    if (!res.ok) {
      setFeedback({ type: "error", text: data.error || "Couldn't reach M-Pesa right now. Try again shortly." });
      return;
    }
    setFeedback({
      type: "success",
      text:
        modal === "deposit"
          ? "Check your phone to approve the M-Pesa prompt."
          : "Withdrawal requested — it'll land on your phone once confirmed.",
    });
    setAmount("");
  }

  return (
    <div className="space-y-6 pb-6">
      <div>
        <p className="text-sm text-muted-foreground">AKIBA Balance</p>
        <p className="mt-1 font-display text-4xl font-semibold tabular-nums">{formatKES(balance)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => setModal("deposit")} className="gap-2">
          <ArrowDownToLine size={16} /> Deposit
        </Button>
        <Button variant="outline" onClick={() => setModal("withdraw")} className="gap-2">
          <ArrowUpFromLine size={16} /> Withdraw
        </Button>
      </div>

      <section>
        <h2 className="mb-1 font-display text-lg font-medium">Transaction history</h2>
        <Card>
          <CardContent className="divide-y divide-border p-0 px-5">
            {transactions.length ? (
              transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No deposits or withdrawals yet.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <AnimatePresence>
        {modal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setModal(null)}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-medium capitalize">{modal}</h3>
                <button onClick={() => setModal(null)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount (KES)</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="1"
                    step="1"
                    required
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                {feedback && (
                  <p className={`text-sm ${feedback.type === "error" ? "text-danger" : "text-success"}`}>
                    {feedback.text}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting
                    ? "Sending…"
                    : modal === "deposit"
                    ? "Send M-Pesa prompt"
                    : "Request withdrawal"}
                </Button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
