// A tiny localStorage-backed queue for mutating requests (deposit/withdraw)
// made while offline. The service worker's Background Sync handler wakes
// this up via postMessage the moment connectivity returns — no need for the
// user to remember to retry anything themselves.
const KEY = "akiba_offline_queue";

export function enqueueRequest({ endpoint, body }) {
  const queue = getQueue();
  queue.push({ id: crypto.randomUUID(), endpoint, body, queuedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function setQueue(queue) {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export async function flushQueue() {
  const queue = getQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(item.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });
      if (!res.ok) remaining.push(item); // server rejected it — keep for visibility, don't loop-retry silently forever
    } catch {
      remaining.push(item); // still offline
    }
  }
  setQueue(remaining);
  return { sent: queue.length - remaining.length, remaining: remaining.length };
}

export async function registerBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  if ("sync" in registration) {
    try {
      await registration.sync.register("akiba-retry-queue");
    } catch {
      // Background Sync not available (e.g. Firefox, iOS Safari) — the
      // queued request still flushes next time the page loads online.
    }
  }
}
