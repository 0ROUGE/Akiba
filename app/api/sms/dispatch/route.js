import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchSms } from "@/lib/sms-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sends every queued SMS (all users) - e.g. right after announcing a feature:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/sms/dispatch
// Fails closed without CRON_SECRET, same as /api/cron/daily.
function isAuthorized(request, secret) {
  const header = request.headers.get("authorization") || "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured: CRON_SECRET is not set." }, { status: 500 });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await dispatchSms(createAdminClient(), { limit: 50, budgetMs: 20000 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("sms dispatch failed", err?.message);
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
