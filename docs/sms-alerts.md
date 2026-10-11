# SMS alerts (Africa's Talking)

Users get a text when:
- their AKIBA balance **drops below their alert level** (default KES 200, `profiles.low_balance_threshold`) - once per crossing, not on every spend
- they **create a new savings goal**
- a **new feature** is announced

Users can turn SMS off with `profiles.sms_enabled = false`. The setting is re-checked at send time.

## Vercel environment variables
| Name | Type | Notes |
|---|---|---|
| `AT_API_KEY` | Secret | Africa's Talking API key |
| `AT_USERNAME` | Config | your AT app username; `sandbox` uses the sandbox (sandbox never reaches real phones) |
| `AT_SENDER_ID` | Config, optional | approved sender ID |
| `CRON_SECRET` | Secret | already used by `/api/cron/daily` |

Until `AT_API_KEY` and `AT_USERNAME` are set, alerts simply stay queued in `sms_outbox` (nothing is lost, nothing fails); they are sent once the variables exist. Alerts older than 2 days are not sent.

## Announce a feature to everyone
```sql
insert into public.feature_announcements (title, body)
values ('New: Receipts', 'Download a receipt for every deposit and withdrawal.');
```
Title <= 50 chars, body <= 95 chars (one SMS segment). This creates an in-app notification and queues an SMS for every user. Send immediately with:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-site>/api/sms/dispatch
```
Otherwise each user's text goes out when they next open the app, or with the daily cron.

## How it flows
1. A database trigger inserts a `notifications` row (`low_balance`, `goal_created`, `feature`).
2. `notifications_queue_sms` queues a row in `sms_outbox` (`pending`, or `skipped` if the phone is invalid or SMS is off).
3. The queue is drained by: `notifyUser()` (M-Pesa callbacks, cron), the dashboard (`/api/sms/flush`, triggered instantly by Realtime and once a minute), and the daily cron.
4. Each row ends `sent`, `failed` (permanent error or 5 attempts) or `skipped`. Inspect with `select status, last_error, count(*) from sms_outbox group by 1,2;`
