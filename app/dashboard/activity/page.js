"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { TransactionRow } from "@/components/transaction-row";
import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  DEFAULT_FILTERS,
  applyToQuery,
  hasActiveFilters,
  normalizeFilters,
} from "@/lib/activity-filters";

const PAGE = 25;

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 p-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

// Search every deposit, withdrawal, goal move and spend: by text (description or M-Pesa
// receipt), type, status, date range and amount range. Loads 25 at a time.
export default function ActivityPage() {
  const supabase = createClient();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState(""); // debounced copy of filters.q
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearchText(filters.q), 350);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const normalized = useMemo(
    () => normalizeFilters({ ...filters, q: searchText }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.type, filters.status, filters.from, filters.to, filters.min, filters.max, searchText]
  );

  const run = useCallback(
    async (offset) => {
      if (!normalized.ok) return;
      const id = ++latest.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError("");
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const query = applyToQuery(
          supabase.from("ledger_transactions").select("*").eq("user_id", user.id),
          normalized.params
        )
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + PAGE - 1);
        const { data, error: queryError } = await query;
        if (id !== latest.current) return; // a newer search replaced this one
        if (queryError) throw queryError;
        setRows((prev) => (offset === 0 ? data : [...prev, ...data]));
        setHasMore(data.length === PAGE);
      } catch {
        if (id === latest.current) setError("Couldn't load your transactions. Check your connection and try again.");
      } finally {
        if (id === latest.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [supabase, normalized]
  );

  useEffect(() => {
    run(0);
  }, [run]);

  const set = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));
  const active = hasActiveFilters(filters);

  return (
    <div className="space-y-5 pb-6">
      <Link href="/dashboard/balance" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft size={14} /> Balance
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold">All transactions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search and filter everything that has moved through AKIBA.</p>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          inputMode="search"
          aria-label="Search transactions"
          placeholder="Search description or M-Pesa code"
          value={filters.q}
          onChange={set("q")}
          className="pl-10 pr-10"
        />
        {filters.q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setFilters((f) => ({ ...f, q: "" }))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {ACTIVITY_TYPES.map((t) => (
          <Chip key={t.id} active={filters.type === t.id} onClick={() => setFilters((f) => ({ ...f, type: t.id }))}>
            {t.label}
          </Chip>
        ))}
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {ACTIVITY_STATUSES.map((s) => (
          <Chip key={s.id} active={filters.status === s.id} onClick={() => setFilters((f) => ({ ...f, status: s.id }))}>
            {s.label}
          </Chip>
        ))}
      </div>

      <details className="rounded-xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-medium">Date and amount</summary>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="act-from">From</Label>
            <Input id="act-from" type="date" value={filters.from} onChange={set("from")} max={filters.to || undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-to">To</Label>
            <Input id="act-to" type="date" value={filters.to} onChange={set("to")} min={filters.from || undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-min">Min amount (KES)</Label>
            <Input id="act-min" inputMode="numeric" autoComplete="off" value={filters.min} onChange={set("min")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-max">Max amount (KES)</Label>
            <Input id="act-max" inputMode="numeric" autoComplete="off" value={filters.max} onChange={set("max")} />
          </div>
        </div>
      </details>

      {active && (
        <button
          type="button"
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className="text-sm font-medium text-primary"
        >
          Clear all filters
        </button>
      )}

      {!normalized.ok && (
        <p role="alert" className="text-sm text-danger">
          {normalized.error}
        </p>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => run(0)}>
            Retry
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <Skeleton />
          ) : rows.length ? (
            <div className="divide-y divide-border px-5">
              {rows.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {active ? "No transactions match those filters." : "No transactions yet."}
            </p>
          )}
        </CardContent>
      </Card>

      {hasMore && !loading && (
        <Button variant="outline" className="w-full gap-2" onClick={() => run(rows.length)} disabled={loadingMore}>
          {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null} Load more
        </Button>
      )}
    </div>
  );
}
