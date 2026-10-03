"use client";

import { motion } from "framer-motion";

/**
 * AKIBA's loading state: the "A" badge breathing inside a soft, drifting
 * halo — a calmer stand-in for a spinner. Used for session checks, route
 * transitions, and any "setting things up" moment.
 */
export function AkibaLoader({ label = "Setting things up", fullScreen = false }) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-5">
      <div className="relative h-20 w-20">
        <motion.span
          className="absolute inset-0 rounded-full bg-primary/20 blur-xl"
          animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
        />
        <div className="absolute inset-[18px] flex items-center justify-center rounded-full bg-akiba-gradient shadow-lift">
          <span className="font-display text-lg font-semibold text-white">A</span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{label}&hellip;</p>
    </div>
  );

  if (!fullScreen) return content;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {content}
    </div>
  );
}
