import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryStkStatus } from "@/lib/mpesa";
import { notifyUser } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// User-triggered equivalent of the daily cron's reconciliation sweep, scoped to
// one of their own transactions - resolves a stuck 'pending' deposit right away by
// asking Safaricom directly. Updates are conditional on 'pending' so this can never
// overwrite what the callback already decided (they can race).
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
      .select("id, user_id, amount, mpesa_receipt_number, mpesa_transaction_status")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .eq("type", "deposit")
      .maybeSingle();

    if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    if (tx.mpesa_transaction_status !== "pending") {
      return NextResponse.json({ status: tx.mpesa_transaction_status });
    }
    // Not handed to Safaricom yet (or the hand-off failed): nothing to ask about.
    if (!tx.mpesa_receipt_number || !tx.mpesa_receipt_number.startsWith("ws_CO_")) {
      return NextResponse.json({ status: "pending" });
    }

    const status = await queryStkStatus({ checkoutRequestId: tx.mpesa_receipt_number });
    const resultCode = String(status.ResultCode);

    if (resultCode === "0") {
      const { data: updated } = await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "confirmed" })
        .eq("id", tx.id)
        .eq("mpesa_transaction_status", "pending")
        .select("id");
      if (updated?.length) {
        await notifyUser(admin, tx.user_id, {
          title: "Deposit confirmed",
          body: `KES ${tx.amount} has landed in your AKIBA balance.`,
          type: "deposit_confirmed",
        });
      }
      return NextResponse.json({ status: "confirmed" });
    }

    if (resultCode === "1037" || resultCode === "500.001.1001") {
      return NextResponse.json({ status: "pending" }); // still awaiting the user on the phone
    }

    const description = resultCode === "1032" ? "Cancelled on phone" : status.ResultDesc || "Deposit failed";
    await admin
      .from("ledger_transactions")
      .update({ mpesa_transaction_status: "failed", description })
      .eq("id", tx.id)
      .eq("mpesa_transaction_status", "pending");
    return NextResponse.json({ status: "failed", reason: description });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Couldn't check status right now" }, { status: 500 });
  }
}
