import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";

// Lets a signed-in user fire a real push at their own subscribed devices —
// the "does this actually work" button, rather than taking it on faith.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return NextResponse.json(
      { error: "VAPID keys aren't configured on the server yet." },
      { status: 500 }
    );
  }

  const admin = createAdminClient();
  const { data: subs } = await admin.from("push_subscriptions").select("id").eq("user_id", user.id);

  if (!subs?.length) {
    return NextResponse.json({ error: "No push subscription found for this account yet." }, { status: 400 });
  }

  await notifyUser(admin, user.id, {
    title: "AKIBA test notification",
    body: "If you can see this, push is wired up correctly.",
    type: "test",
  });

  return NextResponse.json({ sent: true, deviceCount: subs.length });
}
