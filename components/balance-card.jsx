"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { formatKES } from "@/lib/utils";

export function BalanceCard({ balance = 0, pendingCount = 0 }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => formatKES(v));
  const spanRef = useRef(null);

  useEffect(() => {
    const controls = animate(motionValue, balance, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
    });
    const unsubscribe = rounded.on("change", (v) => {
      if (spanRef.current) spanRef.current.textContent = v;
    });
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [balance]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="rounded-xl bg-akiba-gradient p-6 text-white shadow-lift"
    >
      <p className="text-sm text-white/70">AKIBA Balance</p>
      <p ref={spanRef} className="mt-2 font-display text-4xl font-semibold tabular-nums">
        {formatKES(0)}
      </p>
      {pendingCount > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs">
          {pendingCount} transaction{pendingCount > 1 ? "s" : ""} pending confirmation
        </p>
      )}
    </motion.div>
  );
}
