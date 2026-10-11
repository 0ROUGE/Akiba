import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTotpCode } from "@/lib/totp";
import { beginAttempt } from "@/lib/pin";

const SESSION_COOKIE = "akiba_2fa_ok";
const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

// Verifies a 6-digit TOTP code against the user's stored secret. Used both
// during initial setup (flips two_factor_enabled on first success) and on
// every subsequent login (confirms the code and marks this session as having
// passed 2FA via an httpOnly cookie scoped to this user's id).
//
// Attempts are reserved atomically BEFORE the comparison and locked out after
// repeated failures, so the 6-digit space can't be brute-forced by hammering
// this endpoint. Writes to the 2FA columns use the service role: the browser
// client is no longer allowed to touch them.
export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const code = body?.code;
    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("two_factor_secret, two_factor_enabled")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.two_factor_secret) {
      return NextResponse.json({ error: "2FA has not been set up" }, { status: 400 });
    }

    const gate = await beginAttempt(admin, user.id, "totp");
    if (gate.status === "locked") {
      return NextResponse.json(
        { verified: false, locked: true, lockedUntil: gate.locked_until, error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    if (!verifyTotpCode(profile.two_factor_secret, code, user.email || user.id)) {
      return NextResponse.json({ verified: false, attemptsLeft: gate.attempts_left }, { status: 200 });
    }

    await admin.rpc("reset_step_up_attempts", { p_user: user.id, p_scope: "totp" });

    if (!profile.two_factor_enabled) {
      await admin.from("profiles").update({ two_factor_enabled: true }).eq("id", user.id);
    }

    const response = NextResponse.json({ verified: true });
    response.cookies.set(SESSION_COOKIE, user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Couldn't verify right now" }, { status: 500 });
  }
}
