import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, verifyPin, validatePinFormat } from "@/lib/pin";
import { attemptWithLockout, issueStepUp, verifyTotpCode } from "@/lib/step-up";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function currentUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Does this user have a withdrawal PIN yet? (never returns the hash)
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data } = await createAdminClient()
      .from("withdrawal_pins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({ hasPin: Boolean(data) });
  } catch {
    return NextResponse.json({ error: "Couldn't check your PIN right now." }, { status: 500 });
  }
}

// action "verify": { pin }                       -> checks the PIN, issues the 5-minute step-up cookie
// action "set":    { newPin, currentPin | code } -> first PIN needs an authenticator code; changing
//                                                   needs the current PIN (or a code if it's forgotten)
// Wrong PINs / codes are rate-limited (5 misses -> 15 min lock, doubling).
export async function POST(request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("withdrawal_pins")
      .select("pin_hash")
      .eq("user_id", user.id)
      .maybeSingle();

    const pinAttempt = (pin) =>
      attemptWithLockout(admin, user.id, "pin", async () => {
        return typeof pin === "string" && /^\d{4,6}$/.test(pin) && (await verifyPin(user.id, pin, row.pin_hash));
      });
    const totpAttempt = (code) =>
      attemptWithLockout(admin, user.id, "totp", async () => {
        return typeof code === "string" && (await verifyTotpCode(admin, user, code)).ok;
      });

    if (body?.action === "verify") {
      if (!row) return NextResponse.json({ error: "Set a withdrawal PIN first.", code: "PIN_REQUIRED" }, { status: 403 });
      const r = await pinAttempt(body.pin);
      if (!r.ok) return NextResponse.json({ verified: false, error: r.error }, { status: r.status });
      const response = NextResponse.json({ verified: true });
      await issueStepUp(response, user.id);
      return response;
    }

    if (body?.action === "set") {
      const format = validatePinFormat(body.newPin);
      if (!format.ok) return NextResponse.json({ error: format.error }, { status: 400 });

      let proof;
      if (row && typeof body.currentPin === "string" && body.currentPin) {
        proof = await pinAttempt(body.currentPin);
      } else if (typeof body.code === "string" && body.code) {
        proof = await totpAttempt(body.code);
      } else {
        return NextResponse.json(
          { error: row ? "Enter your current PIN or an authenticator code." : "Enter the code from your authenticator app." },
          { status: 400 }
        );
      }
      if (!proof.ok) return NextResponse.json({ error: proof.error }, { status: proof.status });

      const { error } = await admin.from("withdrawal_pins").upsert({
        user_id: user.id,
        pin_hash: await hashPin(user.id, body.newPin),
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);

      const response = NextResponse.json({ saved: true });
      await issueStepUp(response, user.id);
      return response;
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("step-up pin failed:", err?.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
