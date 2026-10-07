import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseInstallment } from "@/lib/payouts";

// Cancelling a plan pays out whatever's left right away, as one final
// release, rather than leaving locked funds stranded with no way back to
// spendable balance — "cancel" means "give me the rest now," not "forfeit it."
export async function POST(request, { params }) {
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

    const admin = createAdminClient();
    const { data: schedule } = await admin
      .from("payout_schedules")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!schedule) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (schedule.status !== "active") {
      return NextResponse.json({ error: "Plan is no longer active" }, { status: 400 });
    }

    const remaining = Number(schedule.total_amount) - Number(schedule.released_amount);

    if (remaining > 0) {
      const result = await releaseInstallment(admin, schedule, remaining);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 502 });
      }
      await admin
        .from("payout_schedules")
        .update({ released_amount: schedule.total_amount, status: "cancelled" })
        .eq("id", schedule.id);
    } else {
      await admin.from("payout_schedules").update({ status: "cancelled" }).eq("id", schedule.id);
    }

    return NextResponse.json({ cancelled: true, releasedRemaining: remaining });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Unexpected server error" }, { status: 500 });
  }
}
