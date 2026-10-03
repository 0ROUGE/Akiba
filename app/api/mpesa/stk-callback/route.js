import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";

// Safaricom calls this directly — no user session, no auth header. Trust
// only the CheckoutRequestID to look up which row this belongs to, and
// never infer success from anything other than ResultCode === 0.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const callback = body?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID) {
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored" });
  }

  const admin = createAdminClient();
  const { data: tx } = await admin
    .from("ledger_transactions")
    .select("id, user_id, amount")
    .eq("mpesa_receipt_number", callback.CheckoutRequestID)
    .eq("type", "deposit")
    .maybeSingle();

  if (!tx) {
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Unmatched, ignored" });
  }

  if (callback.ResultCode === 0) {
    const items = callback.CallbackMetadata?.Item || [];
    const receipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;

    await admin
      .from("ledger_transactions")
      .update({
        mpesa_transaction_status: "confirmed",
        mpesa_receipt_number: receipt || callback.CheckoutRequestID,
      })
      .eq("id", tx.id);

    await notifyUser(admin, tx.user_id, {
      title: "Deposit confirmed",
      body: `KES ${tx.amount} has landed in your AKIBA balance.`,
      type: "deposit_confirmed",
    });
  } else {
    await admin
      .from("ledger_transactions")
      .update({
        mpesa_transaction_status: "failed",
        description: callback.ResultDesc || "Deposit failed",
      })
      .eq("id", tx.id);

    await notifyUser(admin, tx.user_id, {
      title: "Deposit didn't go through",
      body: callback.ResultDesc || "Your M-Pesa deposit could not be completed.",
      type: "deposit_failed",
    });
  }

  // Daraja expects this exact shape to stop retrying the callback.
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
