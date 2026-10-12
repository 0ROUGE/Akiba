import { notifyUser } from "@/lib/notify";

export const SANDBOX_NOTE = "Sandbox withdrawal (simulated, no real money sent)";

// Confirms ONE simulated withdrawal. The update is conditional on is_simulated AND
// still-pending, so it can never touch a real payout and can never fire twice.
export async function settleSimulatedWithdrawal(admin, txId) {
  const { data: tx, error } = await admin
    .from("ledger_transactions")
    .update({ mpesa_transaction_status: "confirmed" })
    .eq("id", txId)
    .eq("type", "withdrawal")
    .eq("is_simulated", true)
    .eq("mpesa_transaction_status", "pending")
    .select("id, user_id, amount")
    .maybeSingle();
  if (error || !tx) return { settled: false };

  await notifyUser(admin, tx.user_id, {
    title: "Withdrawal sent (sandbox)",
    body: `KES ${tx.amount} sandbox payout completed. No real money moved.`,
    type: "withdrawal_confirmed",
  });
  return { settled: true, tx };
}

// Sweeps simulated withdrawals nobody is waiting on any more (user closed the tab).
export async function settleStaleSimulated(admin, { userId = null, olderThanMs = 3000, limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  let query = admin
    .from("ledger_transactions")
    .select("id")
    .eq("is_simulated", true)
    .eq("type", "withdrawal")
    .eq("mpesa_transaction_status", "pending")
    .lte("created_at", cutoff)
    .limit(limit);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query;

  let settled = 0;
  for (const row of data ?? []) {
    const r = await settleSimulatedWithdrawal(admin, row.id);
    if (r.settled) settled += 1;
  }
  return settled;
}
