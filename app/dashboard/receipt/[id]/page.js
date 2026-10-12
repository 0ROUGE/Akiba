import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { ReceiptActions } from "@/components/receipt-actions";
import { formatKES } from "@/lib/utils";
import { buildReceipt } from "@/lib/receipt";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = { title: "Receipt · AKIBA" };

export default async function ReceiptPage({ params }) {
  if (!UUID_RE.test(params.id)) notFound();

  const supabase = createClient();
  // Row Level Security guarantees this only returns the signed-in user's own rows.
  const { data: tx } = await supabase
    .from("ledger_transactions")
    .select("id, type, amount, mpesa_receipt_number, mpesa_transaction_status, description, created_at")
    .eq("id", params.id)
    .maybeSingle();

  // Receipts only exist for transactions that were actually confirmed.
  if (!tx || tx.mpesa_transaction_status !== "confirmed") notFound();

  const receipt = buildReceipt(tx, formatKES);

  return (
    <div className="space-y-6 pb-6">
      <Link href="/dashboard/balance" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground print:hidden">
        <ArrowLeft size={14} /> Back
      </Link>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 size={36} className="text-success" />
            <p className="text-sm text-muted-foreground">{receipt.label} confirmed</p>
            <p className="font-display text-3xl font-semibold tabular-nums">{receipt.amount}</p>
          </div>

          <dl className="divide-y divide-border text-sm">
            {receipt.rows.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="text-xs text-muted-foreground">
            This is AKIBA&rsquo;s record of a confirmed transaction. It is not an official M-Pesa statement.
          </p>
        </CardContent>
      </Card>

      <ReceiptActions text={receipt.text} receipt={receipt} />
    </div>
  );
}
