import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stkPush } from "@/lib/mpesa";
import { withCallbackToken } from "@/lib/callback-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// M-Pesa's own single-transaction ceiling.
const MAX_DEPOSIT = 250_000;

// Starts a real M-Pesa deposit: inserts a 'pending' ledger row, then asks
// Daraja to push an STK prompt to the user's phone. The row only ever
// becomes 'confirmed' when /api/mpesa/stk-callback (or a status query) hears
// back from Safaricom - this route never marks money as received on its own.
// It returns the ledger row's id so the app can follow that exact deposit
// (spinner -> success screen), even across a page refresh. It deliberately does
// NOT return Daraja's CheckoutRequestID: the browser has no need for it.
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

    const body = await request.json().catch(() => ({}));
    const amount = body?.amount;
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_DEPOSIT) {
      return NextResponse.json(
        { error: `Enter a whole amount from KES 1 to KES ${MAX_DEPOSIT.toLocaleString("en-KE")}.` },
        { status: 400 }
      );
    }

    const { data: profile } = await supabase.from("profiles").select("phone").eq("id", user.id).single();
    if (!profile?.phone) {
      return NextResponse.json({ error: "No phone number on file" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: tx, error: insertError } = await admin
      .from("ledger_transactions")
      .insert({
        user_id: user.id,
        type: "deposit",
        amount,
        mpesa_transaction_status: "pending",
        description: "M-Pesa deposit",
      })
      .select()
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    try {
      const callbackUrl = withCallbackToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/stk-callback`);
      const result = await stkPush({
        phone: profile.phone,
        amount,
        accountReference: `AKIBA-${tx.id.slice(0, 8)}`,
        description: "AKIBA deposit",
        callbackUrl,
      });

      // Stash Daraja's CheckoutRequestID so the callback can match it back to this row.
      await admin
        .from("ledger_transactions")
        .update({ mpesa_receipt_number: result.CheckoutRequestID })
        .eq("id", tx.id);

      return NextResponse.json({ status: "pending", transactionId: tx.id });
    } catch (err) {
      await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "failed", description: `Deposit failed: ${err.message}` })
        .eq("id", tx.id)
        .eq("mpesa_transaction_status", "pending");
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
