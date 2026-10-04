"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const IDLE_THRESHOLD_MS = 60 * 1000; // 1 minute of no interaction
const WARNING_COUNTDOWN_S = 20; // grace period shown in the popup
const MOBILE_QUERY = "(max-width: 767px)"; // matches the app's existing md breakpoint
const ACTIVITY_EVENTS = ["touchstart", "scroll", "click", "keydown"];

// Phone-only: a laptop session left idle in a background tab is normal; a
// phone left unlocked on a table with a banking app open is the actual risk
// this is guarding against. Desktop/laptop viewports never mount the timer.
export function IdleLogoutGuard() {
  const supabase = createClient();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_COUNTDOWN_S);

  const idleTimer = useRef(null);
  const countdownTimer = useRef(null);
  const warningRef = useRef(false); // avoids resetting the countdown on activity caught during the warning itself

  const signOutNow = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }, [supabase, router]);

  const clearTimers = () => {
    clearTimeout(idleTimer.current);
    clearInterval(countdownTimer.current);
  };

  const startWarning = useCallback(() => {
    warningRef.current = true;
    setWarning(true);
    setSecondsLeft(WARNING_COUNTDOWN_S);
    countdownTimer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(countdownTimer.current);
          signOutNow();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [signOutNow]);

  const resetIdleTimer = useCallback(() => {
    if (warningRef.current) return; // ignore background activity once the modal is up — only the explicit button counts
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(startWarning, IDLE_THRESHOLD_MS);
  }, [startWarning]);

  function handleStayLoggedIn() {
    warningRef.current = false;
    setWarning(false);
    clearTimers();
    resetIdleTimer();
  }

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      clearTimers();
      return;
    }

    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetIdleTimer));

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
      clearTimers();
    };
  }, [isMobile, resetIdleTimer]);

  if (!isMobile) return null;

  return (
    <AnimatePresence>
      {warning && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="w-full max-w-xs rounded-2xl bg-card p-6 text-center shadow-lift"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
              <span className="font-display text-lg font-semibold text-warning">{secondsLeft}</span>
            </div>
            <h3 className="mt-4 font-display text-lg font-medium">Still there?</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You&apos;ll be signed out in {secondsLeft}s for your security.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button onClick={handleStayLoggedIn} className="w-full">
                Stay logged in
              </Button>
              <Button variant="ghost" onClick={signOutNow} className="w-full">
                Log out now
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
