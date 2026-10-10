"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatKES } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import { dayRangeToIso, directionOf, formatNairobi, summarizeLedger } from "@/lib/statement";

const ROW_LIMIT = 5000;
const TYPE_LABEL = { deposit: "Deposit", withdrawal: "Withdrawal", allocation: "Allocation to goal", spend: "Spend" };

function isoDay(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function StatementPage() {
  const supabase = createClient();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => isoDay(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(() => isoDay(today));
  const [includeAll, setIncludeAll] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    const range = dayRangeToIso(from, to);
    if (!range) {
      setError("Choose a valid date range (the end can't be before the start).");
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    let query = supabase
      .from("ledger_transactions")
      .select("id, type, amount, mpesa_receipt_number, mpesa_transaction_status, description, created_at")
      .gte("created_at", range.startIso)
      .lt("created_at", range.endIso)
      .order("created_at", { ascending: true })
      .limit(ROW_LIMIT);
    if (!includeAll) query = query.eq("mpesa_transaction_status", "confirmed");
    const { data, error: loadError } = await query;
    if (loadError) {
      setError("Couldn't load your statement. Check your connection and try again.");
      setRows([]);
    } else {
      setRows(data ?? []);
      setTruncated((data ?? []).length >= ROW_LIMIT);
    }
    setLoading(false);
  }, [supabase, from, to, includeAll]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => summarizeLedger(rows), [rows]);

  function downloadCsv() {
    const csv = toCsv(rows, [
      { header: "Date (EAT)", value: (r) => formatNairobi(r.created_at) },
      { header: "Type", value: (r) => TYPE_LABEL[r.type] ?? r.type },
      { header: "Direction", value: (r) => directionOf(r.type) },
      { header: "Amount (KES)", value: (r) => Number(r.amount) },
      { header: "Status", value: (r) => r.mpesa_transaction_status },
      { header: "Description", value: (r) => r.description },
      { header: "M-Pesa reference", value: (r) => r.mpesa_receipt_number },
      { header: "AKIBA reference", value: (r) => r.id.slice(0, 8).toUpperCase() },
    ]);
    // BOM so Excel opens the file as UTF-8.
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `akiba-statement-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-6 pb-6">
      <Link href="/dashboard/account" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground print:hidden">
        <ArrowLeft size={14} /> Back
      </Link>

      <div>
        <h1 className="font-display text-2xl font-semibold">Statement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {from} to {to} · times in East Africa Time
        </p>
      </div>

      <Card className="print:hidden">
        <CardContent className="space-y-4 pt-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-from">From</Label>
              <Input id="st-from" type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-to">To</Label>
              <Input id="st-to" type="date" min={from} max={isoDay(today)} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
            Include pending and failed transactions
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={downloadCsv} disabled={loading || rows.length === 0} className="gap-1.5">
              <Download size={15} /> Download CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={loading || rows.length === 0} className="gap-1.5">
              <Printer size={15} /> Print / save PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-5 text-sm sm:grid-cols-4">
              <Stat label="Deposits" value={formatKES(summary.deposits)} />
              <Stat label="Withdrawals" value={formatKES(summary.withdrawals)} />
              <Stat label="To goals" value={formatKES(summary.allocations)} />
              <Stat label="Net" value={formatKES(summary.net)} />
            </CardContent>
          </Card>

          {truncated && (
            <p className="text-sm text-warning">Showing the first {ROW_LIMIT.toLocaleString()} transactions. Narrow the date range to see the rest.</p>
          )}

          <Card>
            <CardContent className="overflow-x-auto p-0">
              {rows.length ? (
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="border-b border-border text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Reference</th>
                      <th className="px-4 py-3 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-4 py-3">{formatNairobi(r.created_at)}</td>
                        <td className="px-4 py-3">
                          {TYPE_LABEL[r.type] ?? r.type}
                          {r.mpesa_transaction_status !== "confirmed" && (
                            <span className="ml-2 text-xs capitalize text-muted-foreground">({r.mpesa_transaction_status})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.mpesa_receipt_number || r.id.slice(0, 8).toUpperCase()}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {directionOf(r.type) === "In" ? "+" : "−"} {formatKES(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No transactions in this period.</p>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            AKIBA&rsquo;s own record of your transactions. Totals count confirmed transactions only. It is not an official M-Pesa statement.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums">{value}</p>
    </div>
  );
}
