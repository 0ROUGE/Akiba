"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Wallet, ReceiptText, UserRound } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useT } from "@/components/language-provider";

const tabs = [
  { href: "/dashboard", labelKey: "nav.home", icon: Home, exact: true },
  { href: "/dashboard/balance", labelKey: "nav.balance", icon: Wallet },
  { href: "/dashboard/spending", labelKey: "nav.spending", icon: ReceiptText },
  { href: "/dashboard/account", labelKey: "nav.account", icon: UserRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useT();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card px-4 py-6 md:flex print:hidden">
      <span className="font-display px-2 text-xl font-semibold">AKIBA</span>

      <nav className="mt-10 flex flex-1 flex-col gap-1" aria-label="Primary">
        {tabs.map(({ href, labelKey, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className="relative rounded-lg px-3 py-2.5 text-sm font-medium">
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-lg bg-primary/10"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span className={`relative z-10 flex items-center gap-3 ${active ? "text-primary" : "text-foreground/80"}`}>
                <Icon size={18} />
                {t(labelKey)}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">{t("sidebar.theme")}</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
