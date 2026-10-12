import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReceiptPdf, receiptFilename } from "@/lib/receipt-pdf";

// Buffer + hand-written PDF => Node.js runtime, and never cached/prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/receipts/<ledger transaction id>/pdf
// Returns the AKIBA PDF receipt for one CONFIRMED transaction that belongs to
// the signed-in user. Ownership is enforced by Row Level Security (the query
// runs as the user), so another person's id simply returns 404 — same as an
// id that doesn't exist, so nothing is revealed about other accounts.
export async function GET(_request, { params }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: tx, error } = await supabase
    .from("ledger_transactions")
    .select("id, type, amount, mpesa_receipt_number, mpesa_transaction_status, description, created_at")
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    console.error("receipt pdf: lookup failed", error.message);
    return NextResponse.json({ error: "Couldn't load that receipt" }, { status: 500 });
  }
  // Receipts only exist for transactions that actually completed.
  if (!tx || tx.mpesa_transaction_status !== "confirmed") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  let pdf;
  try {
    pdf = buildReceiptPdf({ tx, profile });
  } catch (err) {
    console.error("receipt pdf: build failed", err?.message);
    return NextResponse.json({ error: "Couldn't create the receipt" }, { status: 500 });
  }

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receiptFilename(tx)}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
