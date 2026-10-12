import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";
import { isValidCallbackRequest } from "@/lib/callback-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Safaricom's B2C result callback. Shape: { Result: { ConversationID,
// OriginatorConversationID, ResultCode, ResultDesc, ResultParameters: {...} } }
// Matched on OriginatorConversationID - the id WE generated when initiating.
//
// Requires the secret ?k= token we put in the URL: the originator id is readable by
// the user (it sits in their own ledger row), so without the token anyone could post
// a fake "failed" for a payout that actually succeeded and keep both the money and
// the balance. Only ever moves a row out of 'pending', exactly once.
export async function POST(request) {
  if (!isValidCallbackRequest(request)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const result = body?.Result;
    if (!result?.OriginatorConversationID) {
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored" });
    }

    const admin = createAdminClient();
    const { data: tx, error: findError } = await admin
      .from("ledger_transactions")
      .select("id, user_id, amount, mpesa_transaction_status")
      .eq("mpesa_receipt_number", result.OriginatorConversationID)
      .eq("type", "withdrawal")
      .maybeSingle();
    if (findError) throw findError;

    if (!tx) return NextResponse.json({ ResultCode: 0, ResultDesc: "Unmatched, ignored" });
    if (tx.mpesa_transaction_status !== "pending") {
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" });
    }

    if (Number(result.ResultCode) === 0) {
      const params = result.ResultParameters?.ResultParameter || [];
      const receipt = params.find((p) => p.Key === "TransactionReceipt")?.Value;

      const { data: updated, error } = await admin
        .from("ledger_transactions")
        .update({
          mpesa_transaction_status: "confirmed",
          mpesa_receipt_number: receipt ? String(receipt) : result.OriginatorConversationID,
        })
        .eq("id", tx.id)
        .eq("mpesa_transaction_status", "pending")
        .select("id");
      if (error) throw error;

      if (updated?.length) {
        await notifyUser(admin, tx.user_id, {
          title: "Withdrawal sent",
          body: `KES ${tx.amount} is on its way to your phone.`,
          type: "withdrawal_confirmed",
        });
      }
    } else {
      const { data: updated, error } = await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "failed", description: result.ResultDesc || "Withdrawal failed" })
        .eq("id", tx.id)
        .eq("mpesa_transaction_status", "pending")
        .select("id");
      if (error) throw error;

      if (updated?.length) {
        await notifyUser(admin, tx.user_id, {
          title: "Withdrawal didn't go through",
          body: result.ResultDesc || "Your withdrawal could not be completed.",
          type: "withdrawal_failed",
        });
      }
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("b2c-callback failed:", err?.message);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }
}
