import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates an automatic allowance: locks `total_amount` out of the spendable
// AKIBA balance right away (same one-way "allocation" convention goals
// already use — this money is committed, not just earmarked), then a daily
// cron (see /api/cron/daily) pays out `amount_per_release` on schedule as a
// real M-Pesa B2C transfer until the total is exhausted.
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

    const { label, totalAmount, frequency, amountPerRelease, goalId } = await request.json();

    if (!totalAmount || totalAmount <= 0) {
      return NextResponse.json({ error: "Enter a total amount to lock in" }, { status: 400 });
    }
    if (!["daily", "weekly"].includes(frequency)) {
      return NextResponse.json({ error: "Frequency must be daily or weekly" }, { status: 400 });
    }
    if (!amountPerRelease || amountPerRelease <= 0) {
      return NextResponse.json({ error: "Enter an amount to release each time" }, { status: 400 });
    }
    if (amountPerRelease > totalAmount) {
      return NextResponse.json({ error: "Release amount can't exceed the total" }, { status: 400 });
    }

    const { data: balanceRow } = await supabase
      .from("akiba_balances")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();

    if ((balanceRow?.balance ?? 0) < totalAmount) {
      return NextResponse.json({ error: "Insufficient AKIBA balance" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { error: ledgerError } = await admin.from("ledger_transactions").insert({
      user_id: user.id,
      type: "allocation",
      amount: totalAmount,
      mpesa_transaction_status: "confirmed",
      description: label ? `Locked for plan: ${label}` : "Locked for allowance plan",
    });
    if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 500 });

    const { data: schedule, error: scheduleError } = await admin
      .from("payout_schedules")
      .insert({
        user_id: user.id,
        label: label || null,
        goal_id: goalId || null,
        total_amount: totalAmount,
        frequency,
        amount_per_release: amountPerRelease,
        next_release_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (scheduleError) return NextResponse.json({ error: scheduleError.message }, { status: 500 });

    return NextResponse.json({ schedule });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
