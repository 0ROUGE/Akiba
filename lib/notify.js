import webpush from "web-push";

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com";
  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
}

// Writes an in-app notification row AND best-effort fans it out as a Web
// Push to every device the user has subscribed. Push failures (expired
// subscriptions, etc.) never block the in-app notification from being saved.
export async function notifyUser(admin, userId, { title, body, type }) {
  await admin.from("notifications").insert({ user_id: userId, title, body, type });

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
        // 410/404 means the subscription is dead — clean it up.
        if (err.statusCode === 410 || err.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );
}
