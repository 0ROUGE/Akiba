"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Wallet, ReceiptText, UserRound } from "lucide-react";
import { useT } from "@/components/language-provider";

const tabs = [
  { href: "/dashboard", labelKey: "nav.home", icon: Home, exact: true },
  { href: "/dashboard/balance", labelKey: "nav.balance", icon: Wallet },
  { href: "/dashboard/spending", labelKey: "nav.spending", icon: ReceiptText },
  { href: "/dashboard/account", labelKey: "nav.account", icon: UserRound },
];

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useT();

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-lg md:hidden print:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-2">
        {tabs.map(({ href, labelKey, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="relative flex-1">
              <Link
                href={href}
                className="relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium"
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    className="absolute inset-x-3 top-0.5 h-8 rounded-lg bg-primary/10"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon
                  size={20}
                  className={`relative z-10 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
                />
                <span className={`relative z-10 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {t(labelKey)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
