"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { shouldLogoutForAway } from "@/lib/away";

const STORAGE_KEY = "akiba_last_seen";
const HEARTBEAT_MS = 10 * 1000;
// An M-Pesa STK prompt is approved *outside* the app, so a deposit that is
// still pending shouldn't get you logged out while you're on the PIN screen.
const PENDING_DEPOSIT_GRACE_MS = 3 * 60 * 1000;

function readLastSeen() {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null; // storage blocked (private mode etc.) — the in-memory fallback below takes over
  }
}

function writeLastSeen(ts) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

// Logs the user out when they come back after being away from the site for
// more than a minute — whether they switched tabs/apps, locked the phone, or
// closed the PWA and reopened it later. Works on every screen size.
//
// How: while the page is visible we stamp "last seen" every 10s, and once more
// the instant it's hidden. On return we compare against that stamp. We compare
// timestamps (rather than running a 60s timer) because browsers freeze timers
// in background tabs and phones suspend them entirely.
export function AwayLogoutGuard({ signedInAt }) {
  const supabase = createClient();
  const hiddenAtRef = useRef(null); // fallback when localStorage is unavailable
  const checkingRef = useRef(false);

  useEffect(() => {
    const signedInMs = signedInAt ? Number(signedInAt) : null;

    function touch() {
      const now = Date.now();
      hiddenAtRef.current = now;
      writeLastSeen(now);
    }

    async function hasRecentPendingDeposit() {
      try {
        const since = new Date(Date.now() - PENDING_DEPOSIT_GRACE_MS).toISOString();
        // RLS already limits this to the signed-in user's own rows.
        const { data, error } = await supabase
          .from("ledger_transactions")
          .select("id")
          .eq("type", "deposit")
          .eq("mpesa_transaction_status", "pending")
          .gte("created_at", since)
          .limit(1);
        return !error && Array.isArray(data) && data.length > 0;
      } catch {
        return false; // can't confirm a pending deposit → fail closed (log out)
      }
    }

    async function signOutAway() {
      try {
        // "local" ends only THIS device's session — it doesn't kick the user off their other devices.
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        /* even if the network call fails, the redirect below + middleware will gate the dashboard */
      }
      window.location.replace("/login?reason=away");
    }

    async function checkAway() {
      if (checkingRef.current) return;
      const lastSeen = readLastSeen() ?? hiddenAtRef.current;
      const away = shouldLogoutForAway({ now: Date.now(), lastSeen, signedInAt: signedInMs });
      if (!away) {
        touch();
        return;
      }
      checkingRef.current = true;
      if (await hasRecentPendingDeposit()) {
        checkingRef.current = false;
        touch();
        return;
      }
      await signOutAway();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") touch();
      else checkAway();
    }

    function onPageHide() {
      touch();
    }

    function onPageShow(e) {
      if (e.persisted) checkAway(); // restored from the back/forward cache
    }

    // On mount: covers a cold start of the PWA after it was closed for a while.
    checkAway();

    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible" && !checkingRef.current) touch();
    }, HEARTBEAT_MS);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [supabase, signedInAt]);

  return null;
}
