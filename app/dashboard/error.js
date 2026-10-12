"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Catches any unexpected error on a dashboard page so the user sees a calm retry
// screen (with the navigation still in place) instead of a blank crash.
export default function DashboardError({ error, reset }) {
  useEffect(() => {
    console.error("dashboard error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        This page hit a snag. Your money and balance are safe — nothing changes until M-Pesa confirms it.
        Please try again.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-medium"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
