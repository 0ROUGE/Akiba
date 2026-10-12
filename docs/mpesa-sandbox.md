# M-Pesa sandbox, withdrawals and going live

## Why withdrawals used to fail
Safaricom's Daraja **sandbox** can only pay out (B2C) to its own test number, and
rejects every other phone with error 2040 ("Credit Party customer type can't be
supported"). No real money moves in sandbox anyway.

## What AKIBA does now
While `DARAJA_ENV` is **not** `production` (the default), withdrawals are
**simulated** by AKIBA so you can use and test the whole flow:

- `Withdraw` -> spinner ("Sending to your phone") -> success screen with receipt
  download/share, identical to deposits. A refresh keeps you on the right screen.
- Rows are flagged `is_simulated` and labelled "Sandbox withdrawal (simulated, no
  real money sent)" on the screen, history and receipt. Only flagged rows can ever be
  auto-confirmed, and only while still pending.
- Allowance-plan payouts are simulated the same way.
- The balance goes down exactly once per withdrawal.

Deposits are unchanged: they use Safaricom's real sandbox STK Push.

To try Safaricom's *real* sandbox B2C instead, set `SANDBOX_SIMULATE_PAYOUTS=false`
and configure `DARAJA_B2C_SHORTCODE` (the 600xxx test shortcode),
`DARAJA_INITIATOR_NAME`, `DARAJA_SECURITY_CREDENTIAL` and
`DARAJA_SANDBOX_MSISDN=254708374149`.

## When you buy a paybill (going live)
1. Complete Safaricom's Go-Live for your paybill; get production consumer key/secret,
   shortcode, passkey, and a B2C initiator + security credential.
2. In Vercel set `DARAJA_ENV=production` and replace every `DARAJA_*` secret with the
   production value (`DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_B2C_SHORTCODE`,
   `DARAJA_INITIATOR_NAME`, `DARAJA_SECURITY_CREDENTIAL`, keys). Remove
   `DARAJA_SANDBOX_MSISDN`.
3. `NEXT_PUBLIC_APP_URL` must be your live `https://` URL: Safaricom posts results to it.
4. Redeploy. With `DARAJA_ENV=production` simulation is **impossible** (covered by
   `tests/daraja-env.test.mjs`) and every withdrawal is a real B2C payout.

## Callback security
Safaricom's callbacks aren't signed, so every callback URL carries a secret `?k=` token
(derived from a server secret; override with `MPESA_CALLBACK_SECRET`). Callbacks
without it get a 403. Callbacks only move a row out of `pending`, once.
