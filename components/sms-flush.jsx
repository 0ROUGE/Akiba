"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const SMS_TYPES = new Set(["low_balance", "goal_created", "feature"]);

// Invisible. Pushes this user's queued SMS out as soon as a new alert row
// appears (Realtime), when the app opens or regains focus, and once a minute.
export function SmsFlush({ userId }) {
  const busy = useRef(false);
  const debounce = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    const supabase = createClient();

    async function flush() {
      if (busy.current) return;
      busy.current = true;
      try {
        await fetch("/api/sms/flush", { method: "POST" });
      } catch {
        /* offline - the next trigger retries */
      } finally {
        busy.current = false;
      }
    }

    flush();
    const interval = setInterval(flush, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    document.addEventListener("visibilitychange", onVisible);

    const channel = supabase
      .channel(`sms-flush-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!SMS_TYPES.has(payload.new?.type)) return;
          clearTimeout(debounce.current);
          debounce.current = setTimeout(flush, 400);
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      clearTimeout(debounce.current);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
