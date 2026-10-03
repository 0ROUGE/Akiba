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
    <div className="bg-background md:grid md:grid-cols-2">
      {/* Video panel — sticky on mobile (content slides up over it),
          pinned full-height on desktop via grid + sticky. */}
      <div className="sticky top-0 z-0 h-[52vh] md:h-screen md:self-start">
        <HeroVideo />
      </div>

      {/* Content — overlaps the video with a rounded top edge on mobile,
          sits as the normal right column on desktop. */}
      <div className="relative z-10 -mt-7 rounded-t-3xl bg-background md:col-start-2 md:row-start-1 md:mt-0 md:rounded-none">
        <header className="mx-auto flex max-w-xl items-center justify-between px-6 pt-7 sm:px-10">
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

        <section className="mx-auto max-w-xl px-6 pb-20 pt-8 sm:px-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="mb-4 text-sm font-medium text-primary">Built for M-Pesa, Kenya</p>
            <h1 className="font-display text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Akiba is Swahili for savings. This is what practicing it looks like.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              Deposit from M-Pesa, split it into goals and a weekly allowance, and
              withdraw back to your phone whenever you need to.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
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

          <div className="mt-14 grid gap-5 sm:grid-cols-1">
            {features.map(({ icon: Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className="rounded-xl border border-border p-5"
              >
                <Icon size={22} className="text-primary" />
                <h3 className="mt-3 font-display text-base font-medium">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </motion.div>
            ))}
          </div>

          <p className="mt-14 text-sm text-muted-foreground">
            AKIBA never shows your real M-Pesa wallet balance — only what&apos;s confirmed inside your ledger.
          </p>
        </section>
      </div>
    </div>
  );
}
