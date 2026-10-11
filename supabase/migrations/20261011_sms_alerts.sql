-- Applied to the AKIBA Supabase project via MCP on 2026-10-11 (migrations
-- `sms_alerts_africas_talking` + `enable_realtime_notifications`).
-- Kept here so the repo matches the database. Crash-tested live inside a
-- rolled-back transaction: new goal, low-balance crossing (fires once), pending ->
-- confirmed path, feature broadcast to all users, opt-out, invalid phone, atomic claim.

alter table public.profiles
  add column if not exists sms_enabled boolean not null default true,
  add column if not exists low_balance_threshold numeric(12,2) not null default 200
    check (low_balance_threshold >= 0 and low_balance_threshold <= 1000000);

create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  type text not null,
  message text not null,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  provider_message_id text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists sms_outbox_notification_uidx
  on public.sms_outbox (notification_id) where notification_id is not null;
create index if not exists sms_outbox_pending_idx
  on public.sms_outbox (created_at) where status in ('pending','sending');
alter table public.sms_outbox enable row level security;
comment on table public.sms_outbox is 'Server-only SMS queue. RLS on with no policies: only the service role (dispatch route) reads/writes it.';

create or replace function public.queue_sms_for_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pr public.profiles%rowtype; v_phone text; v_ok boolean;
begin
  select * into pr from public.profiles where id = new.user_id;
  if not found or not pr.sms_enabled then return null; end if;
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
  for each row when (new.type in ('low_balance','goal_created','feature'))
  execute function public.queue_sms_for_notification();

create or replace function public.notify_goal_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, title, body, type)
  values (new.user_id, 'New goal created',
          format('"%s" - target %s%s.', left(new.name, 40), public.fmt_kes(new.target_amount),
                 case when new.target_date is not null
                      then ' by ' || to_char(new.target_date, 'DD Mon YYYY') else '' end),
          'goal_created');
  return null;
end;
$$;
revoke all on function public.notify_goal_created() from public, anon, authenticated;
drop trigger if exists savings_goals_created on public.savings_goals;
create trigger savings_goals_created after insert on public.savings_goals
  for each row execute function public.notify_goal_created();

-- Fires once per crossing below the user's alert level, not on every spend.
create or replace function public.notify_low_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_thr numeric; v_after numeric; v_before numeric;
begin
  if tg_op = 'UPDATE' and old.mpesa_transaction_status = 'confirmed' then return null; end if;
  select low_balance_threshold into v_thr from public.profiles where id = new.user_id;
  if v_thr is null or v_thr <= 0 then return null; end if;
  select coalesce(balance, 0) into v_after from public.akiba_balances where user_id = new.user_id;
  v_after := coalesce(v_after, 0);
  v_before := v_after + new.amount;
  if v_before >= v_thr and v_after < v_thr then
    insert into public.notifications (user_id, title, body, type)
    values (new.user_id, 'Low balance',
            'Your AKIBA balance is ' || public.fmt_kes(v_after) || ', below your ' ||
            public.fmt_kes(v_thr) || ' alert level. Top up to stay on track.',
            'low_balance');
  end if;
  return null;
end;
$$;
revoke all on function public.notify_low_balance() from public, anon, authenticated;
drop trigger if exists ledger_low_balance on public.ledger_transactions;
create trigger ledger_low_balance
  after insert or update of mpesa_transaction_status on public.ledger_transactions
  for each row when (new.type in ('withdrawal','allocation','spend')
                     and new.mpesa_transaction_status = 'confirmed')
  execute function public.notify_low_balance();

-- New-feature broadcasts: insert one row, every user is notified (and SMSed).
create table if not exists public.feature_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 50),
  body text not null check (char_length(body) between 3 and 95),
  created_at timestamptz not null default now()
);
alter table public.feature_announcements enable row level security;
comment on table public.feature_announcements is 'Server-only. Insert a row (service role / SQL) to announce a feature to all users.';

create or replace function public.announce_feature_fanout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, title, body, type)
  select p.id, new.title, new.body, 'feature' from public.profiles p;
  return null;
end;
$$;
revoke all on function public.announce_feature_fanout() from public, anon, authenticated;
drop trigger if exists feature_announcements_fanout on public.feature_announcements;
create trigger feature_announcements_fanout after insert on public.feature_announcements
  for each row execute function public.announce_feature_fanout();

create or replace function public.claim_sms_batch(p_limit int default 25, p_user uuid default null)
returns setof public.sms_outbox language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (
    select id from public.sms_outbox
    where (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '5 minutes'))
      and attempts < 5
      and created_at > now() - interval '2 days'
      and (p_user is null or user_id = p_user)
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked)
  update public.sms_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    from c where o.id = c.id
  returning o.*;
end;
$$;
revoke all on function public.claim_sms_batch(int, uuid) from public, anon, authenticated;
grant execute on function public.claim_sms_batch(int, uuid) to service_role;

-- Realtime so the dashboard can flush the SMS queue the instant an alert lands.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
