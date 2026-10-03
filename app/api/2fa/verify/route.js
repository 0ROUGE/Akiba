import { NextResponse } from "next/server";
import * as OTPAuth from "otpauth";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";

const SESSION_COOKIE = "akiba_2fa_ok";
const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

// Verifies a 6-digit TOTP code against the user's stored secret. Used both
// during initial setup (flips two_factor_enabled on first success) and on
// every subsequent login (just confirms the code and marks this session as
// having passed 2FA via an httpOnly cookie scoped to this user's id).
export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { code } = await request.json();
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("two_factor_secret, two_factor_enabled")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.two_factor_secret) {
    return NextResponse.json({ error: "2FA has not been set up" }, { status: 400 });
  }

  const secret = decryptSecret(profile.two_factor_secret);
  const totp = new OTPAuth.TOTP({
    issuer: "AKIBA",
    label: user.email || user.id,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  // window: 1 tolerates ±30s of clock drift between the authenticator app and server
  const delta = totp.validate({ token: code.trim(), window: 1 });
  if (delta === null) {
    return NextResponse.json({ verified: false }, { status: 200 });
  }

  if (!profile.two_factor_enabled) {
    await supabase.from("profiles").update({ two_factor_enabled: true }).eq("id", user.id);
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
}
