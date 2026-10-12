import { b2cPayout } from "@/lib/mpesa";
import { sandboxSimulationEnabled } from "@/lib/daraja-env";
import { withCallbackToken } from "@/lib/callback-auth";
import { SANDBOX_NOTE, settleSimulatedWithdrawal } from "@/lib/sandbox-payouts";

// Releases one installment of a payout schedule, records it as a normal
// 'withdrawal' ledger row (pending until confirmed - same trust rule as every other
// withdrawal), and advances the schedule. Shared by the daily cron and by an
// early/cancel release so both go through the exact same path.
//
// The row carries payout_schedule_id: the plan's full amount was ALREADY deducted
// from the balance when it was created (as an 'allocation'), so a payout row must
// show in history without deducting it a second time - the balance view skips them.
//
// In sandbox (see lib/daraja-env) the payout is simulated and settled right away.
export async function releaseInstallment(admin, schedule, amount) {
  const { data: profile } = await admin.from("profiles").select("phone").eq("id", schedule.user_id).single();

  if (!profile?.phone) {
    return { ok: false, reason: "No phone number on file" };
  }

  const simulated = sandboxSimulationEnabled();
  const baseDescription = schedule.label ? `Allowance: ${schedule.label}` : "Scheduled allowance release";

  const { data: tx, error: insertError } = await admin
    .from("ledger_transactions")
    .insert({
      user_id: schedule.user_id,
      type: "withdrawal",
      amount,
      mpesa_transaction_status: "pending",
      description: simulated ? `${baseDescription} · ${SANDBOX_NOTE}` : baseDescription,
      payout_schedule_id: schedule.id,
      is_simulated: simulated,
    })
    .select()
    .single();

  if (insertError) return { ok: false, reason: insertError.message };

  if (simulated) {
    await settleSimulatedWithdrawal(admin, tx.id);
    return { ok: true, txId: tx.id, simulated: true };
  }

  try {
    const resultUrl = withCallbackToken(`${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-callback`);
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
      .eq("id", tx.id)
      .eq("mpesa_transaction_status", "pending");
    return { ok: false, reason: err.message };
  }
}
