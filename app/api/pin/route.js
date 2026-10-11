import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, validatePinFormat, checkPin } from "@/lib/pin";
import { checkTotp } from "@/lib/totp";
import { describeStepUpFailure } from "@/lib/api-errors";
import { notifyUser } from "@/lib/notify";

// GET  -> { hasPin }
// POST -> set or change the withdrawal PIN.
//   First time:  { pin, totp }            proof = a code from the authenticator app
//   Changing:    { pin, currentPin }  or  { pin, totp }
// The proof is verified on the server on every call and every attempt is
// counted, so this endpoint can't be used to brute-force either secret.

async function currentUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const admin = createAdminClient();
    const { data } = await admin.from("withdrawal_pins").select("user_id").eq("user_id", user.id).maybeSingle();
    return NextResponse.json({ hasPin: Boolean(data) });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "misconfigured", message: "Server misconfigured." }, { status: 500 });
  }
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated", message: "Please sign in again." }, { status: 401 });

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "bad_request", message: "Invalid request." }, { status: 400 });
    }

    const format = validatePinFormat(body?.pin);
    if (!format.ok) {
      return NextResponse.json(
        {
          error: format.reason === "weak" ? "pin_weak" : "pin_invalid_format",
          message:
            format.reason === "weak"
              ? "Too easy to guess. Avoid repeats and runs like 111111 or 123456."
              : "Your PIN must be exactly 6 digits.",
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: existing } = await admin.from("withdrawal_pins").select("user_id").eq("user_id", user.id).maybeSingle();

    // Proof of who's asking. An authenticator code always works; the current
    // PIN also works when changing one. Never "just logged in" — a password
    // alone must not be enough to set the thing that guards withdrawals.
    let proof;
    if (typeof body?.totp === "string") {
      proof = await checkTotp(admin, user.id, body.totp, user.email || user.id);
    } else if (existing && typeof body?.currentPin === "string") {
      proof = await checkPin(admin, user.id, body.currentPin);
    } else {
      return NextResponse.json(
        {
          error: "proof_required",
          message: existing
            ? "Enter your current PIN or an authenticator code to change it."
            : "Enter a code from your authenticator app to set a PIN.",
        },
        { status: 400 }
      );
    }
    if (!proof.ok) {
      const d = describeStepUpFailure(proof);
      return NextResponse.json(d, { status: d.status });
    }

    const { error } = await admin.rpc("set_withdrawal_pin", { p_user: user.id, p_hash: await hashPin(body.pin) });
    if (error) return NextResponse.json({ error: "server_error", message: "Couldn't save your PIN." }, { status: 500 });

    try {
      await notifyUser(admin, user.id, {
        title: existing ? "Withdrawal PIN changed" : "Withdrawal PIN set",
        body: existing
          ? "Your withdrawal PIN was just changed. If this wasn't you, contact support right away."
          : "You'll now need this PIN to withdraw money.",
        type: "security",
        url: "/dashboard/account",
      });
    } catch {}

    return NextResponse.json({ ok: true, changed: Boolean(existing) });
  } catch {
    return NextResponse.json({ error: "server_error", message: "Something went wrong." }, { status: 500 });
  }
}
