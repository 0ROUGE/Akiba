import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueStepUp, verifyFreshPasskey } from "@/lib/step-up";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Biometric re-check before a withdrawal: the client runs a passkey sign-in, then calls
// this. The server only accepts it if it can prove the session was JUST created by a
// passkey enrolled >= 24h ago (see verifyFreshPasskey); otherwise the user uses their PIN.
export async function POST() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const proof = await verifyFreshPasskey(supabase, createAdminClient(), user.id);
    if (!proof.ok) {
      return NextResponse.json(
        {
          verified: false,
          error:
            proof.reason === "passkey-not-trusted"
              ? "New passkeys can't approve withdrawals for the first 24 hours. Use your PIN."
              : "Biometric check wasn't recognised — use your PIN instead.",
          reason: proof.reason,
          methods: proof.methods,
        },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ verified: true });
    await issueStepUp(response, user.id);
    return response;
  } catch (err) {
    console.error("step-up passkey failed:", err?.message);
    return NextResponse.json({ error: "Couldn't verify right now. Use your PIN instead." }, { status: 500 });
  }
}
