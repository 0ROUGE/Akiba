"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TransactionRow } from "@/components/transaction-row";
import { LogSpendDialog } from "@/components/log-spend-dialog";
import { AllowanceDialog } from "@/components/allowance-dialog";
import { formatKES, formatDate } from "@/lib/utils";
import { allowanceState, categoryLabel, summarizeWeek, weekWindow, WEEK_MS } from "@/lib/spending";

const filters = ["All", "Allocations", "Spending"];
const BAR_COLOR = { ok: "bg-primary", warn: "bg-warning", over: "bg-danger" };

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />;
}

export default function SpendingPage() {
  const supabase = createClient();
  const [transactions, setTransactions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [allowance, setAllowance] = useState(null);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [txRes, entryRes, allowanceRes] = await Promise.all([
      supabase
        .from("ledger_transactions")
        .select("*")
        .eq("user_id", user.id)
        .in("type", ["allocation", "spend"])
        .order("created_at", { ascending: false }),
      supabase
        .from("spending_entries")
        .select("id, amount, category, note, spent_at")
        .eq("user_id", user.id)
        .gte("spent_at", new Date(Date.now() - 8 * WEEK_MS).toISOString())
        .order("spent_at", { ascending: false })
        .limit(200),
      supabase.from("allowances").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    if (txRes.error || entryRes.error || allowanceRes.error) {
      setError("Couldn't load your spending. Check your connection and try again.");
    } else {
      setError("");
    }
    setTransactions(txRes.data ?? []);
    setEntries(entryRes.data ?? []);
    setAllowance(allowanceRes.data ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id) {
    if (!window.confirm("Delete this spending entry?")) return;
    const { error: deleteError } = await supabase.from("spending_entries").delete().eq("id", id);
    if (deleteError) {
      setError("Couldn't delete that entry. Please try again.");
      return;
    }
    load();
  }

  // The weekly window follows the allowance's reset date; with no allowance
  // we just show the last 7 days.
  const window7 = useMemo(
    () => (allowance ? weekWindow(allowance.resets_at) : { start: Date.now() - WEEK_MS, end: Date.now() + 1 }),
    [allowance]
  );
  const week = useMemo(() => summarizeWeek(entries, window7), [entries, window7]);
  const state = allowance ? allowanceState(week.total, allowance.weekly_amount) : null;

  const filtered = transactions.filter((t) => {
    if (filter === "All") return true;
    if (filter === "Allocations") return t.type === "allocation";
    return t.type === "spend";
  });

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Spending</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track what you spend. Logged spending is self-reported — it doesn&rsquo;t change your AKIBA balance.
          </p>
        </div>
        <LogSpendDialog onSaved={load} />
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-5">
              {allowance ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Weekly allowance</span>
                    <span className="font-medium tabular-nums">
                      {formatKES(week.total)} / {formatKES(allowance.weekly_amount)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className={`h-full rounded-full ${BAR_COLOR[state.level]}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${state.pct}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {state.level === "over"
                        ? "Allowance used up"
                        : `${formatKES(Math.max(0, allowance.weekly_amount - week.total))} left`}
                    </span>
                    <span>Resets {formatDate(new Date(window7.end).toISOString())}</span>
                  </div>
                  <AllowanceDialog allowance={allowance} onSaved={load}>
                    <button className="text-sm font-medium text-primary">Change allowance</button>
                  </AllowanceDialog>
                </>
              ) : (
                <div className="space-y-2 text-center">
                  <p className="text-sm font-medium">No weekly allowance yet</p>
                  <p className="text-sm text-muted-foreground">
                    Set one and we&rsquo;ll warn you at 80% and when it&rsquo;s used up.
                  </p>
                  <AllowanceDialog allowance={null} onSaved={load}>
                    <Button size="sm">Set weekly allowance</Button>
                  </AllowanceDialog>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{allowance ? "This week by category" : "Last 7 days by category"}</h2>
                <span className="text-sm font-medium tabular-nums">{formatKES(week.total)}</span>
              </div>
              {week.byCategory.length ? (
                <ul className="space-y-3">
                  {week.byCategory.map((c) => (
                    <li key={c.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{c.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatKES(c.amount)} · {c.pct}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${c.pct}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing logged yet. Tap “Log spending” to add your first entry.
                </p>
              )}
            </CardContent>
          </Card>

          {entries.length > 0 && (
            <Card>
              <CardContent className="p-0 px-5">
                <h2 className="pt-5 text-sm font-medium">Logged spending</h2>
                <ul className="divide-y divide-border">
                  {entries.slice(0, 30).map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.note || categoryLabel(e.category)}</p>
                        <p className="text-xs text-muted-foreground">
                          {categoryLabel(e.category)} · {formatDate(e.spent_at)}
                        </p>
                      </div>
                      <p className="text-sm font-medium tabular-nums">− {formatKES(e.amount)}</p>
                      <button
                        onClick={() => handleDelete(e.id)}
                        aria-label="Delete entry"
                        className="text-muted-foreground transition-colors hover:text-danger"
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
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
        </>
      )}
    </div>
  );
}
