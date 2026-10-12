import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { b2cPayout } from "@/lib/mpesa";
import { describeWithdrawalError } from "@/lib/withdrawal-errors";
import { sandboxSimulationEnabled } from "@/lib/daraja-env";
import { withCallbackToken } from "@/lib/callback-auth";
import { SANDBOX_NOTE } from "@/lib/sandbox-payouts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// M-Pesa's own single-transaction ceiling.
const MAX_WITHDRAWAL = 250_000;

// Starts a withdrawal. All the checks (phone on file, 24h hold after a phone
// change, daily limit, balance) and the 'pending' ledger insert happen inside ONE
// database function, start_withdrawal(), under a per-user lock - so two
// simultaneous requests can't both pass the balance check. The row becomes
// 'confirmed' only via the B2C callback (production) or the sandbox simulator.
//
// SANDBOX: Safaricom's sandbox can't pay out to a real phone, so while
// DARAJA_ENV is not "production" the payout is simulated (clearly labelled, flagged
// is_simulated, settled by /api/mpesa/b2c-status). With DARAJA_ENV=production this
// branch is impossible and every withdrawal is a real B2C payout.
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

    const body = await request.json().catch(() => null);
    const amount = body?.amount;
    // Whole shillings only: M-Pesa rounds, so allowing 5.50 would pay out 6.
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_WITHDRAWAL) {
      return NextResponse.json(
        { error: `Enter a whole amount from KES 1 to KES ${MAX_WITHDRAWAL.toLocaleString("en-KE")}.` },
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

    if (sandboxSimulationEnabled()) {
      const { error: flagError } = await admin
        .from("ledger_transactions")
        .update({ is_simulated: true, description: SANDBOX_NOTE })
        .eq("id", txId);
      if (flagError) {
        await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "failed", description: "Withdrawal could not be started" })
          .eq("id", txId)
          .eq("mpesa_transaction_status", "pending");
        return NextResponse.json({ error: "Couldn't start the withdrawal. Please try again." }, { status: 500 });
      }
      return NextResponse.json({ status: "pending", simulated: true, transactionId: txId });
    }

    try {
      const { data: profile } = await admin.from("profiles").select("phone").eq("id", user.id).single();
      const resultUrl = withCallbackToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-callback`);
      // Generated here (not by Safaricom) because v3 requires the caller to
      // supply it - this is also what the callback gets matched back on.
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

      return NextResponse.json({ status: "pending", transactionId: txId, conversationId: result.ConversationID });
    } catch (err) {
      await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "failed", description: `Withdrawal failed: ${err.message}` })
        .eq("id", txId)
        .eq("mpesa_transaction_status", "pending");
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
