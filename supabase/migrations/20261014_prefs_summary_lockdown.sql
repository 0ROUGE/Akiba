-- Applied to the AKIBA Supabase project via MCP on 2026-10-14. Parts A and B were applied
-- separately (A: `notification_prefs_and_monthly_summary`, before the matching code shipped;
-- B: `lock_profile_security_columns`, after it). Crash-tested live in rolled-back transactions.

-- ===== A) Per-type notification preferences + monthly summary =====
-- Preferences: { "push": { "<type>": bool }, "sms": { "<type>": bool } }. A missing key is the
-- type's default (push on; SMS on for low_balance/goal_created/feature, off for monthly_summary).
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
alter table public.profiles
  add constraint profiles_notification_prefs_shape
  check (jsonb_typeof(notification_prefs) = 'object' and pg_column_size(notification_prefs) < 4000);

-- The SMS queue trigger honours the per-type preference. A malformed value can never raise:
-- anything that isn't a JSON boolean falls back to the default.
create or replace function public.queue_sms_for_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pr public.profiles%rowtype; v_phone text; v_ok boolean; v_default boolean; v_pref jsonb; v_on boolean;
begin
  select * into pr from public.profiles where id = new.user_id;
  if not found or not pr.sms_enabled then return null; end if;

  v_default := new.type <> 'monthly_summary';
  v_pref := pr.notification_prefs #> array['sms', new.type];
  v_on := case when jsonb_typeof(v_pref) = 'boolean' then (v_pref)::text::boolean else v_default end;
  if not v_on then return null; end if;

  v_phone := public.norm_phone(pr.phone);
  v_ok := v_phone ~ '^254[17][0-9]{8}$';
  insert into public.sms_outbox (user_id, notification_id, type, message, status, last_error)
  values (new.user_id, new.id, new.type,
          left('AKIBA: ' || new.title || coalesce('. ' || new.body, ''), 160),
          case when v_ok then 'pending' else 'skipped' end,
          case when v_ok then null else 'invalid or missing phone' end)
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.queue_sms_for_notification() from public, anon, authenticated;

drop trigger if exists notifications_queue_sms on public.notifications;
create trigger notifications_queue_sms after insert on public.notifications
  for each row when (new.type in ('low_balance','goal_created','feature','monthly_summary'))
  execute function public.queue_sms_for_notification();

-- Monthly summary: once a month (Nairobi time) every user with confirmed activity in the previous
-- month gets one notification. The log makes a re-run a no-op. Same return shape as
-- run_deposit_reminders so the cron can hand the rows to notifyUser.
create table if not exists public.monthly_summary_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.monthly_summary_log enable row level security;
comment on table public.monthly_summary_log is 'Server-only. RLS on with no policies.';

create or replace function public.run_monthly_summaries(p_force boolean default false)
returns table (user_id uuid, title text, body text, type text)
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_start date := (date_trunc('month', (now() at time zone 'Africa/Nairobi')) - interval '1 month')::date;
  v_end date := date_trunc('month', (now() at time zone 'Africa/Nairobi'))::date;
  r record; v_bal numeric;
begin
  if not p_force and extract(day from v_today) <> 1 then return; end if;

  for r in
    select l.user_id as uid,
           coalesce(sum(l.amount) filter (where l.type = 'deposit'), 0)    as dep,
           coalesce(sum(l.amount) filter (where l.type = 'withdrawal'), 0) as wd,
           coalesce(sum(l.amount) filter (where l.type = 'allocation'), 0) as alloc
    from public.ledger_transactions l
    where l.mpesa_transaction_status = 'confirmed'
      and (l.created_at at time zone 'Africa/Nairobi')::date >= v_start
      and (l.created_at at time zone 'Africa/Nairobi')::date <  v_end
    group by l.user_id
  loop
    insert into public.monthly_summary_log (user_id, month) values (r.uid, v_start) on conflict do nothing;
    if not found then continue; end if;

    select b.balance into v_bal from public.akiba_balances b where b.user_id = r.uid;
    return query select r.uid,
      'Your ' || to_char(v_start, 'FMMonth') || ' summary',
      to_char(v_start, 'FMMon') || ': ' || public.fmt_kes(r.dep) || ' in, ' || public.fmt_kes(r.wd) || ' out, '
        || public.fmt_kes(r.alloc) || ' set aside. Balance ' || public.fmt_kes(coalesce(v_bal, 0)) || '.',
      'monthly_summary'::text;
  end loop;
end;
$$;
revoke all on function public.run_monthly_summaries(boolean) from public, anon, authenticated;
grant execute on function public.run_monthly_summaries(boolean) to service_role;

-- ===== B) Lock down the profile row =====
-- RLS let a signed-in browser update ANY column of its own profile, including
-- two_factor_enabled (switch 2FA off) and two_factor_secret. Browsers may now write only the
-- columns the app screens actually edit; the 2FA columns are written by the server (service
-- role) in /api/2fa/generate and /api/2fa/verify.
revoke insert, update on public.profiles from anon, authenticated;
grant update (full_name, phone, photo_url, dob, daily_withdrawal_limit, daily_limit_change_pending,
              sms_enabled, low_balance_threshold, notification_prefs)
  on public.profiles to authenticated;
