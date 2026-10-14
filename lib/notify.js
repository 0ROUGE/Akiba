import webpush from "web-push";
import { dispatchSms } from "@/lib/sms-dispatch";
import { pushAllowed } from "@/lib/notification-types";

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:jeffersonchirp@gmail.com";
  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey); // throws on malformed keys
    vapidConfigured = true;
  }
}

async function sendPushes(admin, userId, { title, body, type }) {
  ensureVapid();
  if (!vapidConfigured) return;

  // Respect the user's per-type push preference (Account > Notification preferences).
  const { data: profile } = await admin
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (!pushAllowed(profile?.notification_prefs, type)) return;

  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);

  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url: "/dashboard" })
        );
      } catch (err) {
        // 410/404 means the subscription is dead - clean it up.
        if (err.statusCode === 410 || err.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );
}

// SMS alerts are queued by database triggers when the matching notification
// row is inserted; this just drains that user's queue so the text goes out now.
async function flushSms(admin, userId) {
  await dispatchSms(admin, { userId, limit: 10, budgetMs: 4000 });
}

// Writes an in-app notification row, then best-effort fans it out as a Web Push
// and drains the user's SMS queue. NEVER throws: a notification is secondary to
// the money state that triggered it, so a bad push key, a push-service outage or
// an SMS hiccup must not turn a successful M-Pesa callback into a 500 (which makes
// Safaricom retry it).
export async function notifyUser(admin, userId, { title, body, type }) {
  try {
    const { error } = await admin.from("notifications").insert({ user_id: userId, title, body, type });
    if (error) console.error("notify: could not save notification", error.message);
  } catch (err) {
    console.error("notify: insert failed", err?.message);
  }

  const results = await Promise.allSettled([
    sendPushes(admin, userId, { title, body, type }),
    flushSms(admin, userId),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("notify: delivery failed", r.reason?.message);
  }
}
