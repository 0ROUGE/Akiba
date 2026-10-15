import { NextResponse } from "next/server";
import * as OTPAuth from "otpauth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret, isEncryptionConfigError } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Generates a fresh TOTP secret, stores it (encrypted) against the user's profile, and
// returns the otpauth:// URL for the QR code plus the raw base32 key for manual entry.
// two_factor_enabled stays false until the user proves they've set it up, via /api/2fa/verify.
//
// IMPORTANT: once 2FA is enabled this REFUSES. It used to replace the secret for any
// signed-in session - so someone with only a stolen password could mint their own secret,
// verify against it and walk straight past the second factor (and a plain page refresh
// could silently lock the real owner out of their authenticator).
export async function POST() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("two_factor_enabled")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.two_factor_enabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already set up.", code: "ALREADY_ENABLED" },
        { status: 409 }
      );
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
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { otpauth_url: totp.toString(), manual_key: secret.base32 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("2fa generate failed:", err?.message);
    if (isEncryptionConfigError(err)) {
      return NextResponse.json(
        { error: "Two-factor setup isn't configured on the server yet (no encryption key). Please contact support.", code: "CONFIG" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "Couldn't start 2FA setup. Please try again." }, { status: 500 });
  }
}
