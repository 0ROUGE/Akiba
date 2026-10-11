import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { b2cPayout } from "@/lib/mpesa";
import { checkPin } from "@/lib/pin";
import { notifyUser } from "@/lib/notify";
import { describeStepUpFailure, mapWithdrawalError, parseWholeAmount } from "@/lib/api-errors";

// Starts a real M-Pesa withdrawal. Every request must carry the user's
// withdrawal PIN, verified HERE on the server — the screen asking for it is a
// convenience, never the control. (A stolen session cookie alone can't move
// money, because the PIN is checked on every single call.)
//
// Order matters:
//   1. PIN (attempt-counted + locked out after repeated failures)
//   2. start_withdrawal() — one atomic database call that takes the per-user
//      lock and enforces the 24h phone-change hold, the daily limit, and the
//      balance (minus withdrawals still pending), then inserts the 'pending'
//      row. That closes the old check-then-insert race.
//   3. Daraja B2C. The row only becomes 'confirmed' via /api/mpesa/b2c-callback.
export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "misconfigured", message: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is not set." },
      { status: 500 }
    );
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthenticated", message: "Please sign in again." }, { status: 401 });

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "bad_request", message: "Invalid request." }, { status: 400 });
    }

    const amount = parseWholeAmount(body?.amount);
    if (amount === null) {
      return NextResponse.json(
        { error: "invalid_amount", message: "Enter a whole-shilling amount." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // ---- 1. PIN -----------------------------------------------------------
    const pin = await checkPin(admin, user.id, body?.pin);
    if (!pin.ok) {
      if (pin.error === "pin_wrong" && pin.lockedUntil) {
        // This wrong attempt tripped the lockout — tell the owner, in case it wasn't them.
        try {
          await notifyUser(admin, user.id, {
            title: "Withdrawal PIN locked",
            body: "There were several wrong PIN attempts on your account, so withdrawals are paused for a while.",
            type: "security",
            url: "/dashboard/account",
          });
        } catch {}
      }
      const d = describeStepUpFailure(pin);
      return NextResponse.json(d, { status: d.status });
    }

    // ---- 2. Atomic rules + pending row ------------------------------------
    const { data: txId, error: rpcError } = await admin.rpc("start_withdrawal", {
      p_user_id: user.id,
      p_amount: amount,
    });
    if (rpcError) {
      const mapped = mapWithdrawalError(rpcError.message);
      if (mapped) return NextResponse.json(mapped, { status: mapped.status });
      return NextResponse.json(
        { error: "server_error", message: "Couldn't start the withdrawal. Please try again." },
        { status: 500 }
      );
    }

    const { data: profile } = await admin.from("profiles").select("phone").eq("id", user.id).single();

    // ---- 3. Daraja --------------------------------------------------------
    const originatorConversationId = crypto.randomUUID();
    // Persist the id BEFORE calling Safaricom: if the call times out after
    // Safaricom has actually accepted it, the late callback can still find its row.
    await admin.from("ledger_transactions").update({ mpesa_receipt_number: originatorConversationId }).eq("id", txId);

    try {
      const resultUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-callback`;
      const result = await b2cPayout({
        phone: profile.phone,
        amount,
        remarks: `AKIBA-${String(txId).slice(0, 8)}`,
        resultUrl,
        timeoutUrl: resultUrl,
        originatorConversationId,
      });
      return NextResponse.json({ status: "pending", conversationId: result.ConversationID });
    } catch (err) {
      if (err.definitive) {
        await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "failed", description: `Withdrawal failed: ${err.message}` })
          .eq("id", txId);
        return NextResponse.json({ error: "payout_failed", message: err.message }, { status: 502 });
      }
      // No answer from Safaricom: it may or may not have gone through. Leave it
      // pending (it still counts against the balance, so nothing can be spent
      // twice) and let the callback settle it, rather than guessing "failed".
      return NextResponse.json(
        { status: "pending", message: "Sent — waiting for M-Pesa to confirm." },
        { status: 202 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
