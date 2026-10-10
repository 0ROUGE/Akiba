import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { b2cPayout } from "@/lib/mpesa";
import { describeWithdrawalError } from "@/lib/withdrawal-errors";

// M-Pesa's own single-transaction ceiling.
const MAX_WITHDRAWAL = 250_000;

// Starts a real M-Pesa withdrawal. All the checks (phone on file, 24h hold
// after a phone change, daily limit, balance) and the 'pending' ledger insert
// happen inside ONE database function, start_withdrawal(), under a per-user
// lock — so two simultaneous requests can no longer both pass the balance
// check. The row becomes 'confirmed' only via /api/mpesa/b2c-callback.
export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is not set." },
      { status: 500 }
    );
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const amount = Number(body?.amount);
    const validAmount =
      Number.isFinite(amount) && amount > 0 && amount <= MAX_WITHDRAWAL && Math.round(amount * 100) === amount * 100;
    if (!validAmount) {
      return NextResponse.json(
        { error: `Enter an amount above 0 and up to KES ${MAX_WITHDRAWAL.toLocaleString("en-KE")}.` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: txId, error: rpcError } = await admin.rpc("start_withdrawal", {
      p_user_id: user.id,
      p_amount: amount,
    });
    if (rpcError) {
      const friendly = describeWithdrawalError(rpcError.message);
      if (friendly.code === "unknown") console.error("start_withdrawal failed:", rpcError.message);
      return NextResponse.json({ error: friendly.message, code: friendly.code }, { status: 400 });
    }

    const { data: profile } = await admin.from("profiles").select("phone").eq("id", user.id).single();

    try {
      const resultUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-callback`;
      // Generated here (not by Safaricom) because v3 requires the caller to
      // supply it — this is also what the callback gets matched back on.
      const originatorConversationId = crypto.randomUUID();
      const result = await b2cPayout({
        phone: profile.phone,
        amount,
        remarks: `AKIBA-${txId.slice(0, 8)}`,
        resultUrl,
        timeoutUrl: resultUrl,
        originatorConversationId,
      });

      await admin
        .from("ledger_transactions")
        .update({ mpesa_receipt_number: originatorConversationId })
        .eq("id", txId);

      return NextResponse.json({ status: "pending", conversationId: result.ConversationID });
    } catch (err) {
      await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "failed", description: `Withdrawal failed: ${err.message}` })
        .eq("id", txId);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
