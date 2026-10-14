import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Help & FAQ · AKIBA" };
// Read at request time so the test-mode note disappears the moment DARAJA_ENV=production.
export const dynamic = "force-dynamic";

function buildFaqs(testMode) {
  const testNote = testMode
    ? " AKIBA is currently in test (sandbox) mode, so payouts are simulated and no real money leaves."
    : "";
  return [
    {
      q: "What is the AKIBA balance?",
      a: "It's the money you've deposited into AKIBA, minus what you've withdrawn or set aside in goals and plans. AKIBA never reads your real M-Pesa wallet balance (Safaricom doesn't allow that), so the two numbers are different on purpose.",
    },
    {
      q: "How do I deposit?",
      a: "Go to Balance, tap Deposit, enter a whole amount (KES 1 to 250,000) and approve the M-Pesa prompt on your phone with your M-Pesa PIN. The screen updates by itself once it's confirmed and you can download or share a receipt. Refreshing the page doesn't lose your place. AKIBA never sees your M-Pesa PIN.",
    },
    {
      q: "My deposit says pending. What now?",
      a: "Pending means we're waiting for M-Pesa to confirm. That normally takes seconds. If you've already approved it and it's stuck, tap Check status on that transaction. Your balance only changes once M-Pesa confirms.",
    },
    {
      q: "How do withdrawals work?",
      a: `Withdraw sends money back to the phone number on your account. You confirm it with your withdrawal PIN (or biometrics) first, and your balance only drops once M-Pesa confirms the payout.${testNote}`,
    },
    {
      q: "What is the withdrawal PIN?",
      a: "A 4 to 6 digit PIN that protects money leaving AKIBA. Set it under Account, Money controls. The first time you need a code from your authenticator app; later you change it with your current PIN. Five wrong attempts lock it for 15 minutes. If you forget it, choose Change PIN and use an authenticator code instead.",
    },
    {
      q: "Why can't I withdraw right now?",
      a: "The usual reasons: you changed your phone number in the last 24 hours (withdrawals pause for your security), you've reached your daily withdrawal limit, you don't have enough balance (money held for pending withdrawals doesn't count), or there were too many wrong PIN attempts.",
    },
    {
      q: "How do I get a receipt?",
      a: "Open any confirmed deposit or withdrawal and tap View receipt. Download receipt saves it as an image and Share sends it to WhatsApp or anywhere else. Pending or failed transactions don't have a receipt.",
    },
    {
      q: "What are allowance plans?",
      a: "You lock part of your balance and AKIBA pays it to your phone daily or weekly. The whole amount leaves your balance when the plan starts. Cancel and pay out rest sends whatever is left. Starting or cancelling a plan needs your withdrawal PIN.",
    },
    {
      q: "What are savings goals?",
      a: "A goal is a target you save towards. Moving money into a goal takes it out of your spendable AKIBA balance, so it stays set aside until you reach the goal.",
    },
    {
      q: "Which texts and notifications will I get?",
      a: "In the app you always see everything in the bell. By SMS you get a warning when your balance drops below your alert level, a text when you create a goal, and a text when we launch a new feature. You can switch any of these off, per type, under Account, Notification preferences.",
    },
    {
      q: "How does biometric sign-in work?",
      a: "Tap the fingerprint button on the login page. Once a biometric passkey has been on your account for 24 hours it also skips the authenticator code. A passkey you added today still asks for the code until tomorrow, which stops someone with only your password from adding their own.",
    },
    {
      q: "I lost my authenticator app.",
      a: "AKIBA can't reset two-factor for you from the app. If you have a biometric passkey that is more than 24 hours old, sign in with it and you won't be asked for the code. Otherwise contact the AKIBA team.",
    },
  ];
}

export default function HelpPage() {
  const faqs = buildFaqs(process.env.DARAJA_ENV !== "production");
  return (
    <div className="space-y-6 pb-6">
      <Link href="/dashboard/account" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft size={14} /> Account
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold">Help &amp; FAQ</h1>
        <p className="mt-1 text-sm text-muted-foreground">Quick answers about money, security and alerts.</p>
      </div>
      <div className="space-y-2">
        {faqs.map((f) => (
          <details key={f.q} className="group rounded-xl border border-border bg-card px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-medium">{f.q}</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
