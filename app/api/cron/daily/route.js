import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcilePendingDeposits } from "@/lib/reconcile";
import { releaseInstallment } from "@/lib/payouts";

// Runs once a day (Vercel Hobby plan caps cron at once-per-day — see
// vercel.json). Does two unrelated jobs back to back since Hobby also caps
// us at 2 crons/project and bundling keeps this comfortably under that:
//
// 1. Releases any payout_schedules due today (scheduled allowance drips)
// 2. Sweeps STK deposits stuck 'pending' for >20s and asks Safaricom
//    directly what really happened to them — the fallback for missed
//    callbacks, since Hobby can't run a frequent reconciliation sweep
//
// Auth: Vercel's own cron sends `Authorization: Bearer $CRON_SECRET`
// automatically when CRON_SECRET is set — checked here. A `?key=` query
// param is also accepted so this can be triggered manually for testing/
// one-off reconciliation without waiting for the schedule.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    const queryKey = new URL(request.url).searchParams.get("key");
    const authorized = authHeader === `Bearer ${secret}` || queryKey === secret;
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();

  // --- Job 1: release due allowance installments ---
  const { data: due } = await admin
    .from("payout_schedules")
    .select("*")
    .eq("status", "active")
    .lte("next_release_at", new Date().toISOString());

  const releases = [];
  for (const schedule of due || []) {
    const remaining = Number(schedule.total_amount) - Number(schedule.released_amount);
    const releaseAmount = Math.min(Number(schedule.amount_per_release), remaining);
    if (releaseAmount <= 0) {
      await admin.from("payout_schedules").update({ status: "completed" }).eq("id", schedule.id);
      continue;
    }

    const result = await releaseInstallment(admin, schedule, releaseAmount);
    const newReleased = Number(schedule.released_amount) + releaseAmount;
    const isDone = newReleased >= Number(schedule.total_amount);
    const intervalMs = schedule.frequency === "daily" ? 86_400_000 : 7 * 86_400_000;

    await admin
      .from("payout_schedules")
      .update({
        released_amount: result.ok ? newReleased : schedule.released_amount,
        next_release_at: new Date(Date.now() + intervalMs).toISOString(),
        status: result.ok && isDone ? "completed" : "active",
      })
      .eq("id", schedule.id);

    releases.push({ scheduleId: schedule.id, ...result });
  }

  // --- Job 2: reconcile stuck pending deposits ---
  const reconciled = await reconcilePendingDeposits(admin);

  return NextResponse.json({ releases, reconciled });
}
