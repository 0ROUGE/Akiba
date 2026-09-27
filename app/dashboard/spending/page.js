"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { TransactionRow } from "@/components/transaction-row";
import { formatKES } from "@/lib/utils";

const filters = ["All", "Allocations", "Spending"];

export default function SpendingPage() {
  const supabase = createClient();
  const [transactions, setTransactions] = useState([]);
  const [allowance, setAllowance] = useState(null);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: txs }, { data: allowanceRow }] = await Promise.all([
        supabase
          .from("ledger_transactions")
          .select("*")
          .eq("user_id", user.id)
          .in("type", ["allocation", "spend"])
          .order("created_at", { ascending: false }),
        supabase.from("allowances").select("*").eq("user_id", user.id).maybeSingle(),
      ]);
      setTransactions(txs ?? []);
      setAllowance(allowanceRow);
    })();
  }, [supabase]);

  const filtered = transactions.filter((t) => {
    if (filter === "All") return true;
    if (filter === "Allocations") return t.type === "allocation";
    return t.type === "spend";
  });

  const allowancePct = allowance
    ? Math.min(100, Math.round((allowance.spent_this_week / (allowance.weekly_amount || 1)) * 100))
    : 0;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Spending</h1>
        <p className="mt-1 text-sm text-muted-foreground">Where your allocated money is going.</p>
      </div>

      {allowance && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Weekly allowance</span>
              <span className="font-medium tabular-nums">
                {formatKES(allowance.spent_this_week)} / {formatKES(allowance.weekly_amount)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={`h-full rounded-full ${allowancePct >= 100 ? "bg-danger" : allowancePct >= 80 ? "bg-warning" : "bg-primary"}`}
                initial={{ width: 0 }}
                animate={{ width: `${allowancePct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0 px-5">
          {filtered.length ? (
            filtered.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
