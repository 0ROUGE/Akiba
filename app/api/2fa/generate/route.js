import { NextResponse } from "next/server";
import * as OTPAuth from "otpauth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import { checkTotp } from "@/lib/totp";
import { describeStepUpFailure } from "@/lib/api-errors";

// Generates a fresh TOTP secret, stores it (encrypted) against the user's
// profile, and returns the otpauth:// URL for the QR code plus the raw
// base32 key for manual entry. two_factor_enabled stays false until the
// user proves they've actually set it up, via /api/2fa/verify.
//
// SECURITY: once 2FA is enabled this refuses to issue a new secret unless the
// caller proves the CURRENT one. Without that, anyone holding a password-only
// session could re-enrol the authenticator under their own control — quietly
// replacing the real owner's second factor. The write also goes through the
// service role (the browser client can no longer write these columns).
export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("profiles").select("two_factor_enabled").eq("id", user.id).single();

    if (profile?.two_factor_enabled) {
      const body = await request.json().catch(() => ({}));
      if (typeof body?.currentCode !== "string") {
        return NextResponse.json(
          { error: "2fa_already_enabled", message: "Two-factor is already set up. Enter a current code to replace it." },
          { status: 403 }
        );
      }
      const proof = await checkTotp(admin, user.id, body.currentCode, user.email || user.id);
      if (!proof.ok) {
        const d = describeStepUpFailure(proof);
        return NextResponse.json(d, { status: d.status === 400 ? 403 : d.status });
      }
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: "AKIBA",
      label: user.email || user.id,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });

    const { error } = await admin
      .from("profiles")
      .update({ two_factor_secret: encryptSecret(secret.base32) })
      .eq("id", user.id);

    if (error) return NextResponse.json({ error: "Couldn't start 2FA setup" }, { status: 500 });

    return NextResponse.json({ otpauth_url: totp.toString(), manual_key: secret.base32 });
  } catch {
    return NextResponse.json({ error: "Couldn't start 2FA setup" }, { status: 500 });
  }
}
