import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcilePendingDeposits } from "@/lib/reconcile";
import { releaseInstallment } from "@/lib/payouts";
import { notifyUser } from "@/lib/notify";

// Always run at request time, never during `next build`. Without this, Next
// tries to evaluate the route while building; in Preview deployments the
// server secrets (CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY) aren't set, so
// createAdminClient() threw "supabaseKey is required" and failed the build.
export const dynamic = "force-dynamic";

// Runs once a day (Vercel Hobby plan caps cron at once-per-day — see
// vercel.json). Bundles several unrelated jobs, each isolated so one failing
// never stops the others:
//
// 1. Releases any payout_schedules due today (scheduled allowance drips)
// 2. Sweeps STK deposits stuck 'pending' for >20s and asks Safaricom
//    directly what really happened to them (fallback for missed callbacks)
// 3. Runs due auto-save rules (moves AKIBA balance into goals)
// 4. Sends today's deposit reminders
//
// Auth: Vercel's cron sends `Authorization: Bearer $CRON_SECRET`. The route
// FAILS CLOSED: with no CRON_SECRET configured it refuses to run at all
// (previously it silently skipped the check, leaving a route that releases
// real payouts open to anyone). To trigger it by hand:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/daily
function isAuthorized(request, secret) {
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function deliver(admin, events) {
  let sent = 0;
  for (const e of Array.isArray(events) ? events : []) {
    try {
      await notifyUser(admin, e.user_id, { title: e.title, body: e.body, type: e.type });
      sent += 1;
    } catch (err) {
      console.error("cron: notify failed", e.type, err?.message);
    }
  }
  return sent;
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured: CRON_SECRET is not set." }, { status: 500 });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = {};

  // --- Job 1: release due allowance installments ---
  try {
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

      const r = await releaseInstallment(admin, schedule, releaseAmount);
      const newReleased = Number(schedule.released_amount) + releaseAmount;
      const isDone = newReleased >= Number(schedule.total_amount);
      const intervalMs = schedule.frequency === "daily" ? 86_400_000 : 7 * 86_400_000;

      await admin
        .from("payout_schedules")
        .update({
          released_amount: r.ok ? newReleased : schedule.released_amount,
          next_release_at: new Date(Date.now() + intervalMs).toISOString(),
          status: r.ok && isDone ? "completed" : "active",
        })
        .eq("id", schedule.id);

      releases.push({ scheduleId: schedule.id, ...r });
    }
    result.releases = releases;
  } catch (err) {
    console.error("cron: payout releases failed", err?.message);
    result.releases = { error: "failed" };
  }

  // --- Job 2: reconcile stuck pending deposits ---
  try {
    result.reconciled = await reconcilePendingDeposits(admin);
  } catch (err) {
    console.error("cron: reconcile failed", err?.message);
    result.reconciled = { error: "failed" };
  }

  // --- Job 3: auto-save rules (after reconcile, so fresh deposits count) ---
  try {
    const { data: events, error } = await admin.rpc("run_auto_save_rules");
    if (error) throw error;
    result.autoSave = { events: Array.isArray(events) ? events.length : 0, notified: await deliver(admin, events) };
  } catch (err) {
    console.error("cron: auto-save failed", err?.message);
    result.autoSave = { error: "failed" };
  }

  // --- Job 4: deposit reminders ---
  try {
    const { data: events, error } = await admin.rpc("run_deposit_reminders");
    if (error) throw error;
    result.reminders = { events: Array.isArray(events) ? events.length : 0, notified: await deliver(admin, events) };
  } catch (err) {
    console.error("cron: reminders failed", err?.message);
    result.reminders = { error: "failed" };
  }

  return NextResponse.json(result);
}
