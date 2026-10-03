import { NextResponse } from "next/server";
import * as OTPAuth from "otpauth";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";

// Generates a fresh TOTP secret, stores it (encrypted) against the user's
// profile, and returns the otpauth:// URL for the QR code plus the raw
// base32 key for manual entry. two_factor_enabled stays false until the
// user proves they've actually set it up, via /api/2fa/verify.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "AKIBA",
    label: user.email || user.id,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  const { error } = await supabase
    .from("profiles")
    .update({ two_factor_secret: encryptSecret(secret.base32) })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ otpauth_url: totp.toString(), manual_key: secret.base32 });
}
