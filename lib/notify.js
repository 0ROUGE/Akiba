import webpush from "web-push";
import { dispatchSms } from "@/lib/sms-dispatch";

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:jeffersonchirp@gmail.com";
  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
}

async function sendPushes(admin, userId, { title, body }) {
  ensureVapid();
  if (!vapidConfigured) return;

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);

  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
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

// SMS alerts (low balance, new goal, new feature) are queued by database
// triggers when the matching notification row is inserted; this just drains
// that user's queue so the text goes out now. Best-effort, never throws.
async function flushSms(admin, userId) {
  try {
    await dispatchSms(admin, { userId, limit: 10, budgetMs: 4000 });
  } catch (err) {
    console.error("notify: sms flush failed", err?.message);
  }
}

// Writes an in-app notification row, then best-effort fans it out as a Web
// Push to every subscribed device and drains the user's SMS queue. Push/SMS
// failures never block the in-app notification from being saved.
export async function notifyUser(admin, userId, { title, body, type }) {
  await admin.from("notifications").insert({ user_id: userId, title, body, type });
  await Promise.all([sendPushes(admin, userId, { title, body }), flushSms(admin, userId)]);
}
