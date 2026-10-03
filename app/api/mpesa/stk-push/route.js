import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stkPush } from "@/lib/mpesa";

// Starts a real M-Pesa deposit: inserts a 'pending' ledger row, then asks
// Daraja to push an STK prompt to the user's phone. The row only ever
// becomes 'confirmed' when /api/mpesa/stk-callback hears back from Safaricom
// — this route never marks money as received on its own.
export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { amount } = await request.json();
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
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
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/stk-callback`;
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

    return NextResponse.json({ status: "pending", checkoutRequestId: result.CheckoutRequestID });
  } catch (err) {
    await admin
      .from("ledger_transactions")
      .update({ mpesa_transaction_status: "failed", description: `Deposit failed: ${err.message}` })
      .eq("id", tx.id);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
