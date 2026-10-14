import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryStkStatus } from "@/lib/mpesa";
import { notifyUser } from "@/lib/notify";
import { classifyStkResult, isAbandonedUnsent, UNSENT_DESCRIPTION } from "@/lib/stk-result";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// User-triggered equivalent of the daily cron's reconciliation sweep, scoped to
// one of their own transactions - resolves a stuck 'pending' deposit right away by
// asking Safaricom directly. Updates are conditional on 'pending' so this can never
// overwrite what the callback already decided (they can race). What each Safaricom
// ResultCode means lives in lib/stk-result.js, shared with the nightly sweep.
export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const transactionId = body?.transactionId;
    if (typeof transactionId !== "string" || !UUID_RE.test(transactionId)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    const admin = createAdminClient();

    const { data: tx } = await admin
      .from("ledger_transactions")
      .select("id, user_id, amount, mpesa_receipt_number, mpesa_transaction_status, description, created_at")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .eq("type", "deposit")
      .maybeSingle();

    if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    if (tx.mpesa_transaction_status === "failed") {
      return NextResponse.json({ status: "failed", reason: tx.description });
    }
    if (tx.mpesa_transaction_status !== "pending") {
      return NextResponse.json({ status: tx.mpesa_transaction_status });
    }

    const ageMs = Date.now() - new Date(tx.created_at).getTime();

    // Never handed to Safaricom (the request died between "row created" and "prompt sent"):
    // there is nothing to ask about, and nothing that could ever confirm it.
    if (!tx.mpesa_receipt_number || !tx.mpesa_receipt_number.startsWith("ws_CO_")) {
      if (isAbandonedUnsent(tx.mpesa_receipt_number, ageMs)) {
        await admin
          .from("ledger_transactions")
          .update({ mpesa_transaction_status: "failed", description: UNSENT_DESCRIPTION })
          .eq("id", tx.id)
          .eq("mpesa_transaction_status", "pending");
        return NextResponse.json({ status: "failed", reason: UNSENT_DESCRIPTION });
      }
      return NextResponse.json({ status: "pending" });
    }

    const status = await queryStkStatus({ checkoutRequestId: tx.mpesa_receipt_number });
    const outcome = classifyStkResult(status.ResultCode, status.ResultDesc, ageMs);

    if (outcome.action === "pending") return NextResponse.json({ status: "pending" });

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
      return NextResponse.json({ status: "confirmed" });
    }

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
    return NextResponse.json({ status: "failed", reason: outcome.description });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Couldn't check status right now" }, { status: 500 });
  }
}
