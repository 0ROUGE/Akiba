import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryStkStatus } from "@/lib/mpesa";
import { notifyUser } from "@/lib/notify";

// User-triggered equivalent of the daily cron's reconciliation sweep, scoped
// to one of their own transactions — lets someone resolve a stuck 'pending'
// deposit right away instead of waiting for the next scheduled sweep (the
// Hobby plan's once-a-day cron limit means that could otherwise be hours).
export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { transactionId } = await request.json();
    const admin = createAdminClient();

    const { data: tx } = await admin
      .from("ledger_transactions")
      .select("id, user_id, amount, mpesa_receipt_number, mpesa_transaction_status")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .eq("type", "deposit")
      .single();

    if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    if (tx.mpesa_transaction_status !== "pending") {
      return NextResponse.json({ status: tx.mpesa_transaction_status });
    }

    const status = await queryStkStatus({ checkoutRequestId: tx.mpesa_receipt_number });
    const resultCode = String(status.ResultCode);

    if (resultCode === "0") {
      await admin.from("ledger_transactions").update({ mpesa_transaction_status: "confirmed" }).eq("id", tx.id);
      await notifyUser(admin, tx.user_id, {
        title: "Deposit confirmed",
        body: `KES ${tx.amount} has landed in your AKIBA balance.`,
        type: "deposit_confirmed",
      });
      return NextResponse.json({ status: "confirmed" });
    }

    if (resultCode === "1037" || resultCode === "500.001.1001") {
      return NextResponse.json({ status: "pending" }); // still awaiting the user on the phone
    }

    const description = resultCode === "1032" ? "Cancelled on phone" : status.ResultDesc || "Deposit failed";
    await admin
      .from("ledger_transactions")
      .update({ mpesa_transaction_status: "failed", description })
      .eq("id", tx.id);
    return NextResponse.json({ status: "failed", reason: description });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Couldn't check status right now" }, { status: 500 });
  }
}
