"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, PiggyBank, ShieldCheck, Wallet2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    icon: Wallet2,
    title: "Deposit from M-Pesa",
    body: "Move money in with an STK push you approve on your own phone. Nothing leaves M-Pesa without your say-so.",
  },
  {
    icon: PiggyBank,
    title: "Give every shilling a job",
    body: "Split your AKIBA balance into goals, a weekly allowance, and tracked spending — instead of one number that keeps shrinking.",
  },
  {
    icon: ShieldCheck,
    title: "Your money, verified",
    body: "Every balance you see is built from confirmed M-Pesa transactions only. Pending is shown as pending, always.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-display text-xl font-semibold tracking-tight">AKIBA</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login">
            <Button variant="ghost" size="sm">Log in</Button>
          </Link>
          <Link href="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-10 sm:pt-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="mb-5 text-sm font-medium text-primary">Built for M-Pesa, Kenya</p>
          <h1 className="max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Akiba is Swahili for savings. This is what practicing it looks like.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            Deposit from M-Pesa, split it into goals and a weekly allowance, and
            withdraw back to your phone whenever you need to. One ledger, always
            honest about what&apos;s actually confirmed.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/register">
              <Button size="lg" className="group">
                Create your AKIBA account
                <ArrowUpRight
                  size={18}
                  className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">I already have an account</Button>
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-16 overflow-hidden rounded-2xl border border-border bg-akiba-gradient p-8 text-white shadow-lift sm:p-10"
        >
          <p className="text-sm text-white/70">AKIBA Balance</p>
          <p className="mt-2 font-display text-5xl font-semibold tabular-nums">
            KES 24,850.00
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-white/60">Laptop fund</p>
              <p className="mt-1 font-medium">62% there</p>
            </div>
            <div>
              <p className="text-white/60">This week</p>
              <p className="mt-1 font-medium">KES 1,200 of 2,000</p>
            </div>
            <div>
              <p className="text-white/60">Last deposit</p>
              <p className="mt-1 font-medium">Confirmed</p>
            </div>
          </div>
        </motion.div>

        <div className="mt-20 grid gap-6 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border p-6">
              <Icon size={22} className="text-primary" />
              <h3 className="mt-4 font-display text-base font-medium">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">
        AKIBA never shows your real M-Pesa wallet balance — only what&apos;s confirmed inside your ledger.
      </footer>
    </div>
  );
}
