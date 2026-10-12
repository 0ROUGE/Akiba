import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleSimulatedWithdrawal } from "@/lib/sandbox-payouts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Long enough that the "sending to your phone" screen is seen, short enough to feel instant.
const SIMULATED_MIN_AGE_MS = 2500;

// Status of one of the user's own withdrawals. Real payouts are resolved only by
// Safaricom's callback, so for those this just reports the current state. Sandbox
// (simulated) payouts are settled here once they've aged a couple of seconds.
export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const transactionId = body?.transactionId;
    if (typeof transactionId !== "string" || !UUID_RE.test(transactionId)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: tx } = await admin
      .from("ledger_transactions")
      .select("id, mpesa_transaction_status, description, is_simulated, created_at")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .eq("type", "withdrawal")
      .maybeSingle();
    if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    if (tx.mpesa_transaction_status === "failed") {
      return NextResponse.json({ status: "failed", reason: tx.description });
    }
    if (tx.mpesa_transaction_status === "confirmed") return NextResponse.json({ status: "confirmed" });

    if (tx.is_simulated && Date.now() - new Date(tx.created_at).getTime() >= SIMULATED_MIN_AGE_MS) {
      await settleSimulatedWithdrawal(admin, tx.id);
      const { data: fresh } = await admin
        .from("ledger_transactions")
        .select("mpesa_transaction_status")
        .eq("id", tx.id)
        .maybeSingle();
      return NextResponse.json({ status: fresh?.mpesa_transaction_status ?? "pending" });
    }
    return NextResponse.json({ status: "pending" });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Couldn't check status right now" }, { status: 500 });
  }
}
