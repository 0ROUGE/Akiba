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
import { allowanceState, summarizeWeek, weekWindow, WEEK_MS } from "@/lib/spending";
import { useT } from "@/components/language-provider";

const filters = ["All", "Allocations", "Spending"];
const FILTER_KEYS = { All: "spending.filter.all", Allocations: "spending.filter.allocations", Spending: "spending.filter.spending" };
const BAR_COLOR = { ok: "bg-primary", warn: "bg-warning", over: "bg-danger" };

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />;
}

export default function SpendingPage() {
  const { t } = useT();
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
      setError(t("spending.loadError"));
    } else {
      setError("");
    }
    setTransactions(txRes.data ?? []);
    setEntries(entryRes.data ?? []);
    setAllowance(allowanceRes.data ?? null);
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id) {
    if (!window.confirm(t("spending.deleteConfirm"))) return;
    const { error: deleteError } = await supabase.from("spending_entries").delete().eq("id", id);
    if (deleteError) {
      setError(t("spending.deleteError"));
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

  const filtered = transactions.filter((row) => {
    if (filter === "All") return true;
    if (filter === "Allocations") return row.type === "allocation";
    return row.type === "spend";
  });

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("spending.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("spending.subtitle")}
          </p>
        </div>
        <LogSpendDialog onSaved={load} label={t("spending.log")} />
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={load}>{t("common.retry")}</Button>
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
                    <span className="text-muted-foreground">{t("spending.allowance")}</span>
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
                        ? t("spending.usedUp")
                        : t("spending.left", { amount: formatKES(Math.max(0, allowance.weekly_amount - week.total)) })}
                    </span>
                    <span>{t("spending.resets", { date: formatDate(new Date(window7.end).toISOString()) })}</span>
                  </div>
                  <AllowanceDialog allowance={allowance} onSaved={load}>
                    <button className="text-sm font-medium text-primary">{t("spending.changeAllowance")}</button>
                  </AllowanceDialog>
                </>
              ) : (
                <div className="space-y-2 text-center">
                  <p className="text-sm font-medium">{t("spending.noAllowance")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("spending.noAllowanceHint")}
                  </p>
                  <AllowanceDialog allowance={null} onSaved={load}>
                    <Button size="sm">{t("spending.setAllowance")}</Button>
                  </AllowanceDialog>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{allowance ? t("spending.thisWeek") : t("spending.last7")}</h2>
                <span className="text-sm font-medium tabular-nums">{formatKES(week.total)}</span>
              </div>
              {week.byCategory.length ? (
                <ul className="space-y-3">
                  {week.byCategory.map((c) => (
                    <li key={c.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{t(`cat.${c.id}`)}</span>
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
                  {t("spending.nothingLogged")}
                </p>
              )}
            </CardContent>
          </Card>

          {entries.length > 0 && (
            <Card>
              <CardContent className="p-0 px-5">
                <h2 className="pt-5 text-sm font-medium">{t("spending.logged")}</h2>
                <ul className="divide-y divide-border">
                  {entries.slice(0, 30).map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.note || t(`cat.${e.category}`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`cat.${e.category}`)} · {formatDate(e.spent_at)}
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
                {t(FILTER_KEYS[f])}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="divide-y divide-border p-0 px-5">
              {filtered.length ? (
                filtered.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("spending.nothingHere")}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
