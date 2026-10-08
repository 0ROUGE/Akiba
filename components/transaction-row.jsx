"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, ShoppingBag, RefreshCw } from "lucide-react";
import { formatKES, formatDate } from "@/lib/utils";

const typeConfig = {
  deposit: { icon: ArrowDownLeft, label: "Deposit", sign: "+" },
  withdrawal: { icon: ArrowUpRight, label: "Withdrawal", sign: "−" },
  allocation: { icon: PiggyBank, label: "Allocated to goal", sign: "−" },
  spend: { icon: ShoppingBag, label: "Spend", sign: "−" },
};

const statusConfig = {
  confirmed: "text-success",
  pending: "text-warning",
  failed: "text-danger",
};

// onCheckStatus is only passed for pending deposits — lets the person ask
// Safaricom directly instead of waiting on a callback that might have been
// missed (see /api/mpesa/stk-status).
// Confirmed rows link to a shareable receipt.
export function TransactionRow({ tx, onCheckStatus }) {
  const { icon: Icon, label, sign } = typeConfig[tx.type] ?? typeConfig.spend;
  const [checking, setChecking] = useState(false);

  async function handleCheck() {
    setChecking(true);
    await onCheckStatus(tx.id);
    setChecking(false);
  }

  const row = (
    <div className="flex items-center gap-3 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tx.description || label}</p>
        <p className="text-xs text-muted-foreground">{formatDate(tx.created_at)}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-medium tabular-nums">
          {sign} {formatKES(tx.amount)}
        </p>
        {tx.mpesa_transaction_status === "pending" && onCheckStatus ? (
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-1 text-xs text-primary disabled:opacity-60"
          >
            <RefreshCw size={11} className={checking ? "animate-spin" : ""} />
            {checking ? "Checking…" : "Check status"}
          </button>
        ) : (
          <p className={`text-xs capitalize ${statusConfig[tx.mpesa_transaction_status] ?? ""}`}>
            {tx.mpesa_transaction_status}
          </p>
        )}
      </div>
    </div>
  );

  if (tx.mpesa_transaction_status === "confirmed") {
    return (
      <Link href={`/dashboard/receipt/${tx.id}`} className="block transition-colors hover:bg-muted" aria-label={`View receipt: ${tx.description || label}`}>
        {row}
      </Link>
    );
  }
  return row;
}
