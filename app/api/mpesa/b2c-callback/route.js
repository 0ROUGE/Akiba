import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";

// Safaricom's B2C result callback. Shape: { Result: { ConversationID,
// ResultCode, ResultDesc, ResultParameters: { ResultParameter: [...] } } }
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const result = body?.Result;
  if (!result?.ConversationID) {
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored" });
  }

  const admin = createAdminClient();
  const { data: tx } = await admin
    .from("ledger_transactions")
    .select("id, user_id, amount")
    .eq("mpesa_receipt_number", result.ConversationID)
    .eq("type", "withdrawal")
    .maybeSingle();

  if (!tx) {
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Unmatched, ignored" });
  }

  if (result.ResultCode === 0) {
    const params = result.ResultParameters?.ResultParameter || [];
    const receipt = params.find((p) => p.Key === "TransactionReceipt")?.Value;

    await admin
      .from("ledger_transactions")
      .update({
        mpesa_transaction_status: "confirmed",
        mpesa_receipt_number: receipt ? String(receipt) : result.ConversationID,
      })
      .eq("id", tx.id);

    await notifyUser(admin, tx.user_id, {
      title: "Withdrawal sent",
      body: `KES ${tx.amount} is on its way to your phone.`,
      type: "withdrawal_confirmed",
    });
  } else {
    await admin
      .from("ledger_transactions")
      .update({
        mpesa_transaction_status: "failed",
        description: result.ResultDesc || "Withdrawal failed",
      })
      .eq("id", tx.id);

    await notifyUser(admin, tx.user_id, {
      title: "Withdrawal didn't go through",
      body: result.ResultDesc || "Your withdrawal could not be completed.",
      type: "withdrawal_failed",
    });
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
