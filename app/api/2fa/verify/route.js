import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueTwoFa } from "@/lib/two-fa-session";
import { attemptWithLockout, lockedUntil, lockMessage, verifyTotpCode } from "@/lib/step-up";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Verifies a 6-digit TOTP code against the user's stored secret. Used both during
// initial setup (flips two_factor_enabled on first success) and on every later login
// (confirms the code and marks this session as having passed 2FA via a SIGNED httpOnly
// cookie). Guessing is rate-limited: 5 wrong codes lock TOTP for 15 minutes, doubling.
export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const code = body?.code;
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const admin = createAdminClient();

    const until = await lockedUntil(admin, user.id, "totp");
    if (until) return NextResponse.json({ verified: false, error: lockMessage(until) }, { status: 429 });

    let noSetup = false;
    const attempt = await attemptWithLockout(admin, user.id, "totp", async () => {
      const r = await verifyTotpCode(admin, user, code);
      if (r.reason === "no-2fa") noSetup = true;
      return r.ok;
    });
    if (noSetup) return NextResponse.json({ error: "2FA has not been set up" }, { status: 400 });
    if (!attempt.ok) {
      // 200 for an ordinary wrong code (unchanged contract); 429 once locked.
      return NextResponse.json(
        { verified: false, error: attempt.error },
        { status: attempt.status === 429 ? 429 : 200 }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("two_factor_enabled")
      .eq("id", user.id)
      .single();
    if (!profile?.two_factor_enabled) {
      await supabase.from("profiles").update({ two_factor_enabled: true }).eq("id", user.id);
    }

    const response = NextResponse.json({ verified: true });
    await issueTwoFa(response, user.id);
    return response;
  } catch (err) {
    console.error("2fa verify failed:", err?.message);
    return NextResponse.json({ error: "Couldn't verify right now. Please try again." }, { status: 500 });
  }
}
