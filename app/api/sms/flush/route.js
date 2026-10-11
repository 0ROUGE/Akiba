import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchSms } from "@/lib/sms-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Signed-in user's own queued alerts only. The dashboard calls this the moment
// a new alert is created for them (and once a minute as a safety net), which
// is what makes SMS arrive right away instead of waiting for the daily cron.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await dispatchSms(createAdminClient(), { userId: user.id, limit: 10, budgetMs: 6000 });
    return NextResponse.json({ sent: result.sent });
  } catch (err) {
    console.error("sms flush failed", err?.message);
    return NextResponse.json({ error: "Flush failed" }, { status: 500 });
  }
}
