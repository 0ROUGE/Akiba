# Security model (money-out and sign-in)

## Sign-in
- **2FA cookie is signed.** `akiba_2fa_ok` used to be the bare user id, so a password-only
  session could set it by hand and skip the authenticator code. It is now an HMAC-signed,
  expiring, user-bound token (`lib/signed-cookie.js`). Everyone is asked for their code once
  after this deploy, because the old cookie no longer verifies.
- **The authenticator secret can't be replaced once 2FA is on.** `/api/2fa/generate` used to
  overwrite the secret for any signed-in session and hand the new one back, which let a
  stolen password mint its own authenticator and pass 2FA. It now refuses (409) when 2FA is
  already enabled.
- **Browsers can't edit the 2FA columns.** RLS allowed a signed-in browser to update any
  column of its own profile, including `two_factor_enabled` (turn 2FA off) and
  `two_factor_secret`. Column privileges now limit browser writes to the fields the app
  screens edit (name, phone, photo, date of birth, withdrawal limit, notification settings);
  the server writes the 2FA columns with the service role.
- **TOTP guessing is rate-limited:** 5 wrong codes lock TOTP for 15 minutes, doubling on each
  repeat lock (max 24h). The screen shows attempts left / time remaining.
- **Biometric sign-in skips the authenticator code - only when provable.** After a passkey
  login the server checks that (a) this session's token says it came from a passkey and (b)
  the database says a passkey enrolled **at least 24 hours ago** was used in the last 3
  minutes. Otherwise nothing changes and the TOTP screen appears. The 24h rule stops someone
  with only a stolen password from enrolling their own passkey and skipping TOTP. A passkey
  you add today therefore still asks for the code until tomorrow.

## Money out (withdrawals, allowance plans, cancelling a plan)
- A **withdrawal PIN** (4-6 digits; no repeats or sequences) is required. Set it in Account >
  Money controls. The first PIN needs an authenticator code; changing it needs the current PIN
  (or a code if forgotten). It is stored as a salted scrypt hash with a server-side pepper.
- Each withdrawal / plan needs a fresh **PIN or biometric** confirmation, valid for 5 minutes
  and spent when the withdrawal starts (signed `akiba_stepup` cookie).
- Wrong PINs are rate-limited like TOTP. New passkeys (< 24h) can't approve withdrawals.
- Plan payouts honour the same **24-hour hold after a phone-number change** as withdrawals.

## Callbacks
See `docs/mpesa-sandbox.md`: Safaricom callbacks need a secret `?k=` token, and only move a
transaction out of `pending`, once.

## Optional env vars
`AKIBA_COOKIE_SECRET`, `AKIBA_PIN_PEPPER`, `MPESA_CALLBACK_SECRET` override the secret used
for signing cookies / peppering PINs / callback tokens. If unset, an existing server secret
(`TOTP_ENCRYPTION_KEY`, else `SUPABASE_SERVICE_ROLE_KEY`) is used. Changing the secret signs
everyone out of 2FA once and invalidates existing withdrawal PINs (they must be reset with an
authenticator code), so pick one and keep it.
