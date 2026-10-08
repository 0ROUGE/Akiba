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

**Also done (backend, as Next.js Route Handlers on Vercel rather than
Supabase Edge Functions — same "server-side, keys never touch the client"
guarantee, same domain as the app so cookies work cleanly):**
- `/api/2fa/generate` + `/api/2fa/verify` — TOTP secret generated and
  checked server-side, stored AES-256-GCM encrypted; verify also sets an
  httpOnly `akiba_2fa_ok` cookie (scoped to the user id) so 2FA is enforced
  on every login, not just setup — see `lib/supabase/middleware.js`.
- `/api/mpesa/stk-push` + `/api/mpesa/stk-callback` — real Daraja STK Push
  integration (`lib/mpesa.js`). A ledger row starts `pending` and only the
  callback (Safaricom calling back into the app) ever marks it `confirmed`
  or `failed`.
- `/api/mpesa/b2c` + `/api/mpesa/b2c-callback` — same pattern for
  withdrawals. Checks the confirmed balance before initiating (not yet
  row-locked against a double-submit race — fine pre-launch, worth hardening
  with a `FOR UPDATE` Postgres function before real traffic).
- `lib/notify.js` — writes the in-app `notifications` row and fans it out as
  a real Web Push (via `web-push`, using the VAPID keys below) whenever a
  deposit/withdrawal confirms or fails.

**Still needs real credentials before it's live** (code is complete and
wired, just needs secrets):
- Daraja: `DARAJA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY` (sandbox creds from
  the [Safaricom Developer Portal](https://developer.safaricom.co.ke)) plus
  `DARAJA_INITIATOR_NAME`/`DARAJA_SECURITY_CREDENTIAL` for B2C withdrawals.
- `TOTP_ENCRYPTION_KEY` — generate with `openssl rand -base64 32`, set as a
  Vercel **Secret**.
- `NEXT_PUBLIC_APP_URL` — your real Vercel domain, used to build the Daraja
  callback URLs (Safaricom needs a public HTTPS URL, so this won't work from
  `localhost` — test it from a deployed preview).

## Money movement — bugs found and fixed, plus automatic allowances

**B2C withdrawals were failing on every attempt** ("Bad Request - Invalid
OriginatorConversationID"). Root cause: Daraja's B2C **v3** endpoint requires
the caller to generate and send `OriginatorConversationID` — unlike v1,
Safaricom does not default it. `lib/mpesa.js` now generates one per request;
it's also what `/api/mpesa/b2c-callback` matches the result against (not
Safaricom's own `ConversationID`, which the callback also doesn't key the
response on for v3).

**Deposits were getting stuck at 'pending' forever** when a callback got
missed (e.g. `NEXT_PUBLIC_APP_URL` pointing somewhere unreachable during
setup). Since the Vercel Hobby plan caps cron at once a day, waiting for a
scheduled sweep could mean hours stuck pending. Fixed two ways:
- A real "Check status" action now appears next to any pending deposit in
  the Balance page's transaction list (`/api/mpesa/stk-status`) — asks
  Safaricom's STK Push Query API directly what actually happened and
  updates the row for real. Never guesses, never marks something confirmed
  without Daraja's own ResultCode saying so.
- `/api/cron/daily` also sweeps any deposit still pending after 20s as a
  backstop (`lib/reconcile.js`).

**Security fix while wiring up goal allocation**: `allocate_to_goal()` is a
`SECURITY DEFINER` Postgres function reachable directly via RPC. It never
verified the caller actually owned the account they passed as `p_user_id`
— any authenticated user could have drained an arbitrary account's balance
by passing that account's user id. Fixed with an `auth.uid() = p_user_id`
check (plus a goal-ownership check) before anything else runs.

**Allocate to goals now actually works** — `GoalCard` has a real "Allocate
funds" button calling `allocate_to_goal()` via `supabase.rpc(...)` directly
(it's `SECURITY DEFINER`, so no API route needed — the function itself
checks balance and moves the money atomically).

**Automatic allowances** (`payout_schedules` table, `components/
allowance-plans.jsx`, Balance page): lock part of your balance into a plan
— "KES 1000, release KES 500 weekly" or "KES 1000, release ~143/day" — and
`/api/cron/daily` pays out each installment as a real M-Pesa B2C transfer
automatically, once a day, via Vercel Cron (`vercel.json`, scheduled
`0 4 * * *` = ~7am Nairobi time; Hobby plan fires sometime within that
hour, not to the minute). Cancelling a plan immediately pays out whatever's
left as one final release rather than stranding it — "cancel" means "give
me the rest now," not "forfeit it."

Known limitation shared with goal allocation: locking funds into a plan is
one-way at the ledger level (same convention `allocate_to_goal` already
used) — there's no "un-allocate back to spendable balance without actually
receiving the M-Pesa payout" path yet.

**Withdrawals failing with error 2040** ("Credit Party customer type can't
be supported by the service") after the OriginatorConversationID fix: B2C was
using the STK Push shortcode (174379) as PartyA. B2C needs its own shortcode
(`DARAJA_B2C_SHORTCODE`, the 600XXX one on the Daraja portal's Test
Credentials page). Also: the sandbox never pays out to a real phone. It only
accepts Safaricom's test MSISDN, so `DARAJA_SANDBOX_MSISDN` substitutes as the
recipient in sandbox only (hard-disabled when `DARAJA_ENV=production`). Real
money reaching a real phone requires a production paybill/till plus Daraja
Go Live; no code change can substitute for that.

## PWA capabilities
Built out for a clean [PWABuilder](https://www.pwabuilder.com/) report:
- **Service Worker** (`public/sw.js`), registered unconditionally on every
  page load via `components/service-worker-register.jsx` — not just when a
  user opts into push, which is what PWABuilder's "no Service Worker found"
  check was actually catching before.
  - **Has Logic / Offline Support**: network-first for pages with a cached
    shell + `public/offline.html` fallback; cache-first for static assets.
    Deliberately never caches `/dashboard/*` or `/api/*` — balance and
    transaction data must come from the network or be shown as offline,
    never served stale from a cache.
  - **Background Sync**: a deposit/withdrawal made while offline queues
    locally (`lib/offline-queue.js`) and retries automatically the moment
    connectivity returns, via the `sync` event in the service worker.
  - **Periodic Sync**: opportunistically refreshes the cached shell. Most
    browsers (iOS Safari included) never grant this permission — it's a
    progressive enhancement, nothing depends on it firing.
  - **Push Notifications**: as before.
- **App Capabilities** (all in `public/manifest.json`):
  - `launch_handler` (focus existing window), `edge_side_panel`
  - `protocol_handlers` — `web+akiba:` deep links into `/dashboard?action=…`
  - `file_handlers` — "Open with → AKIBA" on an image sets it as your
    profile photo (handled via `launchQueue` in the Account page)
  - `share_target` — AKIBA appears in the OS share sheet for images; shared
    photos upload straight to your profile (`/api/share-target`)
  - `note_taking` — `new_note_url` opens straight into the New Goal dialog
    (`/dashboard/goals?new=1`), the closest real equivalent AKIBA has to
    "jot something down quickly"
  - `display_override` includes `tabbed` and `window-controls-overlay`
- **Not implemented — Widgets**: the Windows 11 Widgets Board needs a full
  Adaptive Card template + a dedicated data endpoint per widget, is
  Windows/Edge-only, and has no natural fit for a savings app's data. Left
  out rather than added as an empty checkbox.

## Biometric sign-in (Passkeys)
Face ID / Touch ID / Android fingerprint / Windows Hello, via Supabase
Auth's native Passkeys (beta — built on WebAuthn, no separate library):
- `lib/supabase/client.js` opts into the experimental API
  (`auth: { experimental: { passkey: true } }`)
- `components/passkey-manager.jsx` (Account page) — register this device,
  list and remove registered passkeys
- `app/(auth)/login/page.js` — "Sign in with biometrics" button when the
  device supports a platform authenticator (feature-detected; hidden
  otherwise), falling back to password underneath

**One manual step you need to do, per environment, once you have a real
domain:** Supabase Dashboard → **Authentication → Passkeys** → enable, then
set:
- **Relying Party ID**: your bare domain, e.g. `akiba.vercel.app` (no
  `https://`, no path)
- **Relying Party Origins**: the full origin(s) that serve the app, e.g.
  `https://akiba.vercel.app`

This can't be filled in generically — it has to match whatever domain the
app is actually served from, and a passkey registered against one RP ID
won't work from another. If you add a custom domain later, update this (and
expect previously-registered passkeys tied to the old domain to stop
working — that's inherent to how WebAuthn binds credentials to an origin,
not a bug).

Passkey sign-in currently still goes through AKIBA's own TOTP 2FA gate
afterwards (middleware doesn't know a login came via passkey vs password).
That's arguably redundant — a passkey is already phishing-resistant and
device-bound — but it errs toward not silently weakening a security
requirement. Worth revisiting once passkey adoption is clear.

## Environment variables
Copy `.env.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from the
  Supabase project dashboard (Project Settings → API).
- `SUPABASE_SERVICE_ROLE_KEY` — same page, **Secret** in Vercel. Used only by
  `/api/mpesa/*` routes to write confirmed transactions (bypassing RLS,
  which deliberately blocks client-side inserts to `ledger_transactions`).
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — a real keypair is
  already generated and in `.env.example`; rotate it with
  `npx web-push generate-vapid-keys` if you want your own.
- `TOTP_ENCRYPTION_KEY`, `DARAJA_*` — see above.
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` / `NEXT_PUBLIC_CLOUDINARY_API_KEY` /
  `CLOUDINARY_API_SECRET` — only needed if you move profile photos off
  Supabase Storage onto Cloudinary; not wired up yet.

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
