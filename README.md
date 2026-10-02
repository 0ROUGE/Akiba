# AKIBA


Personal savings and spending-control app for M-Pesa users in Kenya. Deposit
via M-Pesa STK Push, allocate into goals and a weekly allowance, withdraw via
M-Pesa B2C. The "AKIBA Balance" is always computed from confirmed ledger
entries — it never claims to read your real M-Pesa wallet.

## Stack
- Next.js 14 (App Router) + React, JavaScript
- Tailwind CSS + a small hand-rolled shadcn-style UI kit
- Framer Motion for interaction-driven animation
- Supabase (Postgres, Auth, Storage, Realtime, Edge Functions)
- Web Push (VAPID) for notifications

## Status
**Done:**
- Full Postgres schema (`profiles`, `ledger_transactions`, `savings_goals`,
  `allowances`, `notifications`, `push_subscriptions`) with RLS on every
  table, an `akiba_balances` view, and an `allocate_to_goal` DB function.
- Auth flow UI: register → mandatory profile setup → mandatory 2FA setup →
  dashboard, with middleware route guards and marketing-page bypass for
  logged-in users.
- Dashboard shell: bottom nav (mobile) + sidebar (desktop), Home / Balance /
  Spending / Account pages, dark & light themes.
- Web Push subscribe flow (client registers SW + writes its own
  `push_subscriptions` row — no server round trip needed for this part).
- Avatar upload to Supabase Storage (`avatars` bucket, owner-scoped policies).

**Not yet built (next phase — server-side, Daraja-dependent):**
- `generate-2fa-secret` / `verify-2fa` edge functions (TOTP secret must be
  generated and checked server-side, never in the browser).
- `initiate-stk-push` + its Safaricom callback webhook.
- `initiate-b2c-withdrawal` + its Safaricom callback webhook.
- Edge function that sends Web Push on ledger/notification events.
The frontend already calls these by name via `supabase.functions.invoke(...)`,
so wiring them up is a drop-in once written.

## Environment variables
Copy `.env.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from the
  Supabase project dashboard (Project Settings → API).
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — generate with
  `npx web-push generate-vapid-keys`.
- `SUPABASE_SERVICE_ROLE_KEY`, `DARAJA_*` — only needed once edge functions
  are added; set them as Supabase secrets, not in the Next.js app.

## Local dev
```bash
npm install
npm run dev
```

## Deploying to Vercel
1. Import this repo in Vercel.
2. Add the `NEXT_PUBLIC_*` env vars above in Project Settings → Environment
   Variables (Production + Preview).
3. Enable Google as an OAuth provider in Supabase Auth settings, and add your
   Vercel domain to the redirect URL allow-list.
4. Deploy — no other config needed, `next build` is the default.

## Icons
`public/manifest.json` references `/icon-192.png` and `/icon-512.png`, which
still need to be generated from a real logo (only `favicon.svg` is in place).
