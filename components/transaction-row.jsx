import { ArrowDownLeft, ArrowUpRight, PiggyBank, ShoppingBag } from "lucide-react";
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

export function TransactionRow({ tx }) {
  const { icon: Icon, label, sign } = typeConfig[tx.type] ?? typeConfig.spend;

  return (
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
        <p className={`text-xs capitalize ${statusConfig[tx.mpesa_transaction_status] ?? ""}`}>
          {tx.mpesa_transaction_status}
        </p>
      </div>
    </div>
  );
}
