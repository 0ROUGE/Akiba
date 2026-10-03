"use client";

import { useEffect } from "react";
import { flushQueue } from "@/lib/offline-queue";

// Registers the service worker unconditionally on every page load (not just
// when the user opts into push) so offline caching, the app-shell, and the
// background/periodic sync hooks are actually active for every visitor —
// this is also what PWA auditors (like PWABuilder) detect.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration can fail in dev over http:// or in unsupported
      // browsers — never block the app on it.
    });

    function onMessage(event) {
      if (event.data?.type === "AKIBA_RETRY_QUEUE") flushQueue();
    }
    navigator.serviceWorker.addEventListener("message", onMessage);

    // Also flush opportunistically whenever the browser itself reports
    // coming back online, for browsers without Background Sync support.
    window.addEventListener("online", flushQueue);

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("online", flushQueue);
    };
  }, []);

  return null;
}
