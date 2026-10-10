"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

// One tappable row in a settings card. Pass `href` for navigation or `onClick` for an action.
export function SettingsRow({ icon: Icon, label, value, onClick, href }) {
  const inner = (
    <>
      <Icon size={18} className="text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {value && <span className="text-sm text-muted-foreground">{value}</span>}
      {(onClick || href) && <ChevronRight size={16} className="text-muted-foreground" />}
    </>
  );
  const cls = "flex w-full items-center gap-3 px-5 py-4 text-left disabled:cursor-default";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={cls}>
      {inner}
    </button>
  );
}
