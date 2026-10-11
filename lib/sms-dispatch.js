import { sendSms, smsConfigured, toMsisdn } from "@/lib/sms";

const MAX_ATTEMPTS = 5;

async function mark(admin, id, patch) {
  const { error } = await admin.from("sms_outbox").update(patch).eq("id", id);
  if (error) console.error("sms: could not update outbox row", id, error.message);
}

// One queued SMS. Opt-out and phone are re-checked at send time so a user who
// turned SMS off (or changed number) after the alert was queued is respected.
async function deliverOne(admin, row, totals) {
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("phone, sms_enabled")
      .eq("id", row.user_id)
      .maybeSingle();

    if (!profile || !profile.sms_enabled) {
      await mark(admin, row.id, { status: "skipped", last_error: "sms disabled" });
      totals.skipped += 1;
      return;
    }
    if (!toMsisdn(profile.phone)) {
      await mark(admin, row.id, { status: "skipped", last_error: "invalid or missing phone" });
      totals.skipped += 1;
      return;
    }

    const r = await sendSms(profile.phone, row.message);
    if (r.ok) {
      await mark(admin, row.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: r.messageId,
        last_error: null,
      });
      totals.sent += 1;
    } else if (r.permanent || row.attempts >= MAX_ATTEMPTS) {
      await mark(admin, row.id, { status: "failed", last_error: r.error });
      totals.failed += 1;
    } else {
      // Transient: leave it 'sending'; claim_sms_batch() hands it out again after 5 minutes.
      await mark(admin, row.id, { last_error: r.error });
      totals.retry += 1;
    }
  } catch (err) {
    console.error("sms: delivery error", err?.message);
    await mark(admin, row.id, row.attempts >= MAX_ATTEMPTS
      ? { status: "failed", last_error: "delivery error" }
      : { last_error: "delivery error" });
    totals.retry += 1;
  }
}

// Sends queued SMS. With userId, only that user's rows (used by the signed-in
// flush); without, everyone's (cron / manual dispatch). Never throws on send
// failures - they are recorded on the outbox row.
export async function dispatchSms(admin, { userId = null, limit = 25, budgetMs = 8000 } = {}) {
  const totals = { configured: smsConfigured(), claimed: 0, sent: 0, failed: 0, retry: 0, skipped: 0 };
  if (!totals.configured) return totals; // leave rows queued until credentials exist

  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const { data: rows, error } = await admin.rpc("claim_sms_batch", { p_limit: limit, p_user: userId });
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    totals.claimed += rows.length;
    for (let i = 0; i < rows.length; i += 5) {
      await Promise.all(rows.slice(i, i + 5).map((row) => deliverOne(admin, row, totals)));
    }
    if (rows.length < limit) break;
  }
  return totals;
}
