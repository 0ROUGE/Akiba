import { queryStkStatus } from "@/lib/mpesa";
import { notifyUser } from "@/lib/notify";

// Resolves STK deposits stuck at 'pending' by asking Safaricom directly what
// actually happened — the only trustworthy source of truth when a callback
// is missed (wrong callback URL during setup, a transient network issue,
// etc.). Never guesses; a row only changes based on Daraja's own ResultCode.
export async function reconcilePendingDeposits(admin, { olderThanMs = 20_000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  const { data: stale } = await admin
    .from("ledger_transactions")
    .select("id, user_id, amount, mpesa_receipt_number")
    .eq("type", "deposit")
    .eq("mpesa_transaction_status", "pending")
    .not("mpesa_receipt_number", "is", null)
    .lt("created_at", cutoff);

  const results = [];

  for (const tx of stale || []) {
    try {
      const status = await queryStkStatus({ checkoutRequestId: tx.mpesa_receipt_number });
      const resultCode = String(status.ResultCode);

      if (resultCode === "0") {
        await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "confirmed" })
          .eq("id", tx.id);
        await notifyUser(admin, tx.user_id, {
          title: "Deposit confirmed",
          body: `KES ${tx.amount} has landed in your AKIBA balance.`,
          type: "deposit_confirmed",
        });
        results.push({ id: tx.id, resolved: "confirmed" });
      } else if (resultCode === "1032") {
        // User cancelled/dismissed the STK prompt — not a system failure.
        await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "failed", description: "Cancelled on phone" })
          .eq("id", tx.id);
        results.push({ id: tx.id, resolved: "cancelled" });
      } else if (resultCode !== "1037" && resultCode !== "500.001.1001") {
        // 1037/500.001.1001-style codes mean "still awaiting user action" in
        // various Daraja versions — leave those pending for the next sweep
        // rather than marking them failed prematurely. Anything else is a
        // real, final failure.
        await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "failed", description: status.ResultDesc || "Deposit failed" })
          .eq("id", tx.id);
        await notifyUser(admin, tx.user_id, {
          title: "Deposit didn't go through",
          body: status.ResultDesc || "Your M-Pesa deposit could not be completed.",
          type: "deposit_failed",
        });
        results.push({ id: tx.id, resolved: "failed", reason: status.ResultDesc });
      } else {
        results.push({ id: tx.id, resolved: "still-pending" });
      }
    } catch (err) {
      // Query itself failed (network, Daraja down) — leave as pending, try
      // again next sweep rather than guessing.
      results.push({ id: tx.id, resolved: "query-error", error: err.message });
    }
  }

  return results;
}
