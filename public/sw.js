// AKIBA service worker — handles Web Push display + basic offline shell.
// Registered from the client after the user opts into notifications.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  const { title, body, url } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "AKIBA", {
      body: body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: url || "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(clients.openWindow(url));
});
