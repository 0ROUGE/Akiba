import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { b2cPayout } from "@/lib/mpesa";

// Starts a real M-Pesa withdrawal. Checks the confirmed balance first, then
// inserts a 'pending' row and asks Daraja to pay the user back. Becomes
// 'confirmed' only via /api/mpesa/b2c-callback.
// NOTE: balance check + insert aren't wrapped in a single DB transaction, so
// two withdrawal requests fired at the exact same moment could both pass the
// check before either confirms. Fine for a single-user testing phase; worth
// moving to a `FOR UPDATE`-guarded Postgres function before real traffic.
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

    const { amount } = await request.json();
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const [{ data: profile }, { data: balanceRow }] = await Promise.all([
      supabase.from("profiles").select("phone").eq("id", user.id).single(),
      supabase.from("akiba_balances").select("balance").eq("user_id", user.id).maybeSingle(),
    ]);

    if (!profile?.phone) {
      return NextResponse.json({ error: "No phone number on file" }, { status: 400 });
    }
    if ((balanceRow?.balance ?? 0) < amount) {
      return NextResponse.json({ error: "Insufficient AKIBA balance" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: tx, error: insertError } = await admin
      .from("ledger_transactions")
      .insert({
        user_id: user.id,
        type: "withdrawal",
        amount,
        mpesa_transaction_status: "pending",
        description: "M-Pesa withdrawal",
      })
      .select()
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    try {
      const resultUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-callback`;
      // Generated here (not by Safaricom) because v3 requires the caller to
      // supply it — this is also what the callback gets matched back on.
      const originatorConversationId = crypto.randomUUID();
      const result = await b2cPayout({
        phone: profile.phone,
        amount,
        remarks: `AKIBA-${tx.id.slice(0, 8)}`,
        resultUrl,
        timeoutUrl: resultUrl,
        originatorConversationId,
      });

      await admin
        .from("ledger_transactions")
        .update({ mpesa_receipt_number: originatorConversationId })
        .eq("id", tx.id);

      return NextResponse.json({ status: "pending", conversationId: result.ConversationID });
    } catch (err) {
      await admin
        .from("ledger_transactions")
        .update({ mpesa_transaction_status: "failed", description: `Withdrawal failed: ${err.message}` })
        .eq("id", tx.id);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
