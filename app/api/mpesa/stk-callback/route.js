import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";
import { isValidCallbackRequest } from "@/lib/callback-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Safaricom's STK result callback. It has no signature, so the URL we gave
// Safaricom carries a secret token (?k=) and anything without it is rejected -
// otherwise anyone who knew a CheckoutRequestID could fake a successful deposit.
// Only ever moves a row out of 'pending', exactly once, so Safaricom's retries and
// races with the status check are harmless. Never infers success from anything
// other than ResultCode === 0.
export async function POST(request) {
  if (!isValidCallbackRequest(request)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const callback = body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) {
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored" });
    }

    const admin = createAdminClient();
    const { data: tx, error: findError } = await admin
      .from("ledger_transactions")
      .select("id, user_id, amount, mpesa_transaction_status")
      .eq("mpesa_receipt_number", callback.CheckoutRequestID)
      .eq("type", "deposit")
      .maybeSingle();
    if (findError) throw findError;

    if (!tx) return NextResponse.json({ ResultCode: 0, ResultDesc: "Unmatched, ignored" });
    if (tx.mpesa_transaction_status !== "pending") {
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" });
    }

    if (Number(callback.ResultCode) === 0) {
      const items = callback.CallbackMetadata?.Item || [];
      const receipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;

      const { data: updated, error } = await admin
        .from("ledger_transactions")
        .update({
          mpesa_transaction_status: "confirmed",
          mpesa_receipt_number: receipt ? String(receipt) : callback.CheckoutRequestID,
        })
        .eq("id", tx.id)
        .eq("mpesa_transaction_status", "pending")
        .select("id");
      if (error) throw error;

      if (updated?.length) {
        await notifyUser(admin, tx.user_id, {
          title: "Deposit confirmed",
          body: `KES ${tx.amount} has landed in your AKIBA balance.`,
          type: "deposit_confirmed",
        });
      }
    } else {
      const { data: updated, error } = await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "failed", description: callback.ResultDesc || "Deposit failed" })
        .eq("id", tx.id)
        .eq("mpesa_transaction_status", "pending")
        .select("id");
      if (error) throw error;

      if (updated?.length) {
        await notifyUser(admin, tx.user_id, {
          title: "Deposit didn't go through",
          body: callback.ResultDesc || "Your M-Pesa deposit could not be completed.",
          type: "deposit_failed",
        });
      }
    }

    // Daraja expects this exact shape to stop retrying the callback.
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    // A real failure (e.g. database briefly unavailable): 500 makes Safaricom retry,
    // and the pending-only update above makes that retry safe.
    console.error("stk-callback failed:", err?.message);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }
}
