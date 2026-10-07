import { b2cPayout } from "@/lib/mpesa";

// Releases one installment of a payout schedule as a real M-Pesa B2C
// transfer, records it as a normal 'withdrawal' ledger row (pending until
// the b2c-callback confirms it — same trust rule as every other withdrawal
// in this app), and advances the schedule. Shared by the daily cron and by
// an early/cancel release so both go through the exact same path.
export async function releaseInstallment(admin, schedule, amount) {
  const { data: profile } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", schedule.user_id)
    .single();

  if (!profile?.phone) {
    return { ok: false, reason: "No phone number on file" };
  }

  const { data: tx, error: insertError } = await admin
    .from("ledger_transactions")
    .insert({
      user_id: schedule.user_id,
      type: "withdrawal",
      amount,
      mpesa_transaction_status: "pending",
      description: schedule.label ? `Allowance: ${schedule.label}` : "Scheduled allowance release",
    })
    .select()
    .single();

  if (insertError) return { ok: false, reason: insertError.message };

  try {
    const resultUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-callback`;
    const originatorConversationId = crypto.randomUUID();
    await b2cPayout({
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
    return { ok: true, txId: tx.id };
  } catch (err) {
    await admin
      .from("ledger_transactions")
      .update({ mpesa_transaction_status: "failed", description: `Release failed: ${err.message}` })
      .eq("id", tx.id);
    return { ok: false, reason: err.message };
  }
}
