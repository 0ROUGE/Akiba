import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueTwoFa } from "@/lib/two-fa-session";
import { verifyFreshPasskey } from "@/lib/step-up";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Called right after a passkey (biometric) sign-in. If the server can PROVE that this
// session came from a passkey enrolled at least 24h ago, the authenticator code is
// skipped (a passkey is already device-bound and phishing-resistant). Anything else -
// a password session, a brand-new passkey, an unexpected token shape - gets a 401 and
// the user is simply sent to the normal TOTP screen.
export async function POST() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const proof = await verifyFreshPasskey(supabase, createAdminClient(), user.id);
    if (!proof.ok) {
      return NextResponse.json({ ok: false, reason: proof.reason, methods: proof.methods }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    await issueTwoFa(response, user.id);
    return response;
  } catch (err) {
    console.error("passkey-ok failed:", err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
