import { queryStkStatus } from "@/lib/mpesa";
import { notifyUser } from "@/lib/notify";
import { classifyStkResult, isAbandonedUnsent, UNSENT_DESCRIPTION } from "@/lib/stk-result";

// Resolves STK deposits stuck at 'pending' by asking Safaricom directly what
// actually happened - the only trustworthy source of truth when a callback
// is missed (wrong callback URL during setup, a transient network issue,
// etc.). Never guesses: a row only changes based on Daraja's own ResultCode
// (see lib/stk-result.js), or because it provably never reached Safaricom.
// Every update is conditional on 'pending', so a callback that lands mid-sweep wins.
export async function reconcilePendingDeposits(admin, { olderThanMs = 20_000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  // Includes rows with NO Safaricom reference: those used to be skipped, so a request that
  // died before the prompt was sent stayed 'pending' forever.
  const { data: stale } = await admin
    .from("ledger_transactions")
    .select("id, user_id, amount, mpesa_receipt_number, created_at")
    .eq("type", "deposit")
    .eq("mpesa_transaction_status", "pending")
    .lt("created_at", cutoff)
    .limit(200);

  const results = [];

  for (const tx of stale || []) {
    const ageMs = Date.now() - new Date(tx.created_at).getTime();
    try {
      const sent = typeof tx.mpesa_receipt_number === "string" && tx.mpesa_receipt_number.startsWith("ws_CO_");

      if (!sent) {
        if (isAbandonedUnsent(tx.mpesa_receipt_number, ageMs)) {
          await admin
            .from("ledger_transactions")
            .update({ mpesa_transaction_status: "failed", description: UNSENT_DESCRIPTION })
            .eq("id", tx.id)
            .eq("mpesa_transaction_status", "pending");
          results.push({ id: tx.id, resolved: "abandoned" });
        } else {
          results.push({ id: tx.id, resolved: "still-pending" });
        }
        continue;
      }

      const status = await queryStkStatus({ checkoutRequestId: tx.mpesa_receipt_number });
      const outcome = classifyStkResult(status.ResultCode, status.ResultDesc, ageMs);

      if (outcome.action === "confirm") {
        const { data: updated } = await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "confirmed" })
          .eq("id", tx.id)
          .eq("mpesa_transaction_status", "pending")
          .select("id");
        if (updated?.length) {
          await notifyUser(admin, tx.user_id, {
            title: "Deposit confirmed",
            body: `KES ${tx.amount} has landed in your AKIBA balance.`,
            type: "deposit_confirmed",
          });
        }
        results.push({ id: tx.id, resolved: "confirmed" });
      } else if (outcome.action === "fail") {
        const { data: failed } = await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "failed", description: outcome.description })
          .eq("id", tx.id)
          .eq("mpesa_transaction_status", "pending")
          .select("id");
        if (failed?.length && outcome.notify) {
          await notifyUser(admin, tx.user_id, {
            title: "Deposit didn't go through",
            body: outcome.description,
            type: "deposit_failed",
          });
        }
        results.push({ id: tx.id, resolved: "failed", reason: outcome.description });
      } else {
        results.push({ id: tx.id, resolved: "still-pending" });
      }
    } catch (err) {
      // Query itself failed (network, Daraja down) - leave as pending, try
      // again next sweep rather than guessing.
      results.push({ id: tx.id, resolved: "query-error", error: err.message });
    }
  }

  return results;
}
