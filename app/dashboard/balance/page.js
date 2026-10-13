"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TransactionRow } from "@/components/transaction-row";
import { AllowancePlans } from "@/components/allowance-plans";
import { DepositFlow } from "@/components/deposit-flow";
import { WithdrawFlow } from "@/components/withdraw-flow";
import { StepUpDialog } from "@/components/step-up-dialog";
import { formatKES } from "@/lib/utils";

// Deposits and withdrawals both run through the same flow component (waiting
// spinner, automatic success screen with receipt download/share, survives a
// refresh). Neither ever marks a transaction successful on its own - only
// Safaricom's callback / a status query (or the labelled sandbox simulator) does.
// Withdrawals first ask for the withdrawal PIN (or a biometric check).
export default function BalancePage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [modal, setModal] = useState(null); // "deposit" | "withdraw" | null
  const [stepUp, setStepUp] = useState(null); // { mode: "verify" | "set", retry }

  // Fetches data only - never touches the realtime channel, so calling this
  // on every change event can't multiply subscriptions.
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
      setBalance(Number(balanceRow?.balance ?? 0));
      setTransactions(txs ?? []);
    },
    [supabase]
  );

  const reload = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await loadData(user.id);
  }, [supabase, loadData]);

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

  // Opens the right flow straight away when linked to with ?action=deposit or
  // ?action=withdraw - used by the dashboard quick actions and the web+akiba: handler.
  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "deposit" || action === "withdraw") setModal(action);
  }, [searchParams]);

  async function checkStatus(url, transactionId) {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    }).catch(() => {});
    // Realtime will normally pick up the row change already, but refresh
    // explicitly too in case the websocket missed it.
    await reload();
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

      <AllowancePlans balance={balance} />

      <section>
        <h2 className="mb-1 font-display text-lg font-medium">Transaction history</h2>
        <Card>
          <CardContent className="divide-y divide-border p-0 px-5">
            {transactions.length ? (
              transactions.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  onCheckStatus={(id) =>
                    checkStatus(tx.type === "deposit" ? "/api/mpesa/stk-status" : "/api/mpesa/b2c-status", id)
                  }
                />
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No deposits or withdrawals yet.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <DepositFlow
        open={modal === "deposit"}
        onClose={() => setModal(null)}
        onResume={() => setModal("deposit")}
        onSettled={reload}
      />
      <WithdrawFlow
        open={modal === "withdraw"}
        available={balance}
        onClose={() => setModal(null)}
        onResume={() => setModal("withdraw")}
        onSettled={reload}
        onNeedStepUp={(code, retry) =>
          setStepUp({ mode: code === "PIN_REQUIRED" ? "set" : "verify", retry })
        }
      />

      <StepUpDialog
        open={Boolean(stepUp)}
        mode={stepUp?.mode ?? "verify"}
        hasPin={stepUp?.mode !== "set"}
        onClose={() => setStepUp(null)}
        onDone={() => {
          const retry = stepUp?.retry;
          setStepUp(null);
          retry?.();
        }}
      />
    </div>
  );
}
