import { createClient } from "@/lib/supabase/client";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Registers the service worker, subscribes to Web Push, and stores the
// subscription in `push_subscriptions` (RLS lets a user insert only their
// own row, so no server round-trip is needed for this step).
export async function subscribeToPush() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("unsupported");
  }
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    // Misconfiguration, not a user-facing state — fail loudly in dev.
    throw new Error("missing-vapid-key");
  }

  if (Notification.permission === "denied") {
    throw new Error("permission-denied");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("permission-denied");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  // Re-use an existing subscription if one's already active for this
  // browser instead of creating a duplicate.
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    }));

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const json = subscription.toJSON();
  await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );

  return subscription;
}
