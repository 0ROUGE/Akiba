"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, PiggyBank, ShieldCheck, Wallet2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { HeroVideo } from "@/components/hero-video";

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
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
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

      <section className="mx-auto max-w-3xl px-6 pb-20 pt-4 sm:pt-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="mb-4 text-sm font-medium text-primary">Built for M-Pesa, Kenya</p>
          <h1 className="max-w-xl font-display text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Akiba is Swahili for savings. This is what practicing it looks like.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            Deposit from M-Pesa, split it into goals and a weekly allowance, and
            withdraw back to your phone whenever you need to.
          </p>
        </motion.div>

        {/* Video stays a normal, contained element on the page — sized to
            its own 16:9 footage, not a full-bleed background. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mx-auto mt-9 max-w-xl"
        >
          <HeroVideo />
        </motion.div>

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

        {/* Zigzag on desktop: each row alternates sides and steps down,
            so the same column width reads as full instead of a thin centered
            strip. Collapses to the original stacked layout on mobile. */}
        <div className="relative mt-20">
          <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-border md:block" />
          <div className="space-y-6 md:space-y-10">
            {features.map(({ icon: Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className={`flex items-start gap-4 md:w-[56%] ${
                  i % 2 === 1 ? "md:ml-auto md:flex-row-reverse md:text-right" : ""
                }`}
                style={{ marginTop: i === 0 ? 0 : undefined }}
              >
                <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-background shadow-soft">
                  <Icon size={19} className="text-primary" />
                </span>
                <div className={i % 2 === 1 ? "md:text-right" : ""}>
                  <h3 className="font-display text-base font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="mt-14 text-sm text-muted-foreground">
          AKIBA never shows your real M-Pesa wallet balance — only what&apos;s confirmed inside your ledger.
        </p>
      </section>
    </div>
  );
}
