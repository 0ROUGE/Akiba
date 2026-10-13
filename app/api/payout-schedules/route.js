import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkWithdrawalGate, clearStepUp } from "@/lib/step-up";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const isWhole = (n) => typeof n === "number" && Number.isInteger(n) && n > 0;

// Creates an automatic allowance: locks `total_amount` out of the spendable AKIBA
// balance right away (same one-way "allocation" convention goals use - this money is
// committed, not just earmarked), then a daily cron (see /api/cron/daily) pays out
// `amount_per_release` on schedule as a real M-Pesa B2C transfer until it is exhausted.
//
// Because a plan is a scheduled cash-out it needs the same PIN / biometric confirmation
// as a withdrawal. Whole shillings only (payouts are rounded by M-Pesa). If anything fails
// after the money is locked, the lock is reversed so funds are never stranded.
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
    const { label, totalAmount, frequency, amountPerRelease, goalId } = body;

    if (!isWhole(totalAmount)) {
      return NextResponse.json({ error: "Enter a whole number of shillings to lock in" }, { status: 400 });
    }
    if (!["daily", "weekly"].includes(frequency)) {
      return NextResponse.json({ error: "Frequency must be daily or weekly" }, { status: 400 });
    }
    if (!isWhole(amountPerRelease)) {
      return NextResponse.json({ error: "Enter a whole number of shillings to release each time" }, { status: 400 });
    }
    if (amountPerRelease > totalAmount) {
      return NextResponse.json({ error: "Release amount can't exceed the total" }, { status: 400 });
    }

    const admin = createAdminClient();

    const gate = await checkWithdrawalGate(request, admin, user.id);
    if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: 403 });

    const spendable = async () => {
      const [{ data: bal }, { data: pend }] = await Promise.all([
        admin.from("akiba_balances").select("balance").eq("user_id", user.id).maybeSingle(),
        admin
          .from("ledger_transactions")
          .select("amount")
          .eq("user_id", user.id)
          .eq("type", "withdrawal")
          .eq("mpesa_transaction_status", "pending")
          .is("payout_schedule_id", null),
      ]);
      const reserved = (pend ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
      return Number(bal?.balance ?? 0) - reserved;
    };

    if ((await spendable()) < totalAmount) {
      return NextResponse.json({ error: "Insufficient AKIBA balance" }, { status: 400 });
    }

    const { data: lock, error: ledgerError } = await admin
      .from("ledger_transactions")
      .insert({
        user_id: user.id,
        type: "allocation",
        amount: totalAmount,
        mpesa_transaction_status: "confirmed",
        description: label ? `Locked for plan: ${String(label).slice(0, 60)}` : "Locked for allowance plan",
      })
      .select("id")
      .single();
    if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 500 });

    const undoLock = () => admin.from("ledger_transactions").delete().eq("id", lock.id);

    // Two simultaneous requests can both pass the check above; this catches the loser.
    if ((await spendable()) < 0) {
      await undoLock();
      return NextResponse.json({ error: "Insufficient AKIBA balance" }, { status: 400 });
    }

    const { data: schedule, error: scheduleError } = await admin
      .from("payout_schedules")
      .insert({
        user_id: user.id,
        label: label ? String(label).slice(0, 60) : null,
        goal_id: goalId || null,
        total_amount: totalAmount,
        frequency,
        amount_per_release: amountPerRelease,
        next_release_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (scheduleError) {
      await undoLock();
      return NextResponse.json({ error: scheduleError.message }, { status: 500 });
    }

    const response = NextResponse.json({ schedule });
    clearStepUp(response);
    return response;
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
