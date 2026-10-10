-- Applied to the AKIBA Supabase project via MCP on 2026-10-09 (features 5, 6, 7, 10).
-- Kept here so the repo matches the database. All of it was crash-tested against
-- the live database inside rolled-back transactions.

-- ===== shared helpers =====
create or replace function public.fmt_kes(n numeric)
returns text language sql immutable set search_path = '' as $$
  select 'KES ' || case when n = trunc(n)
    then trim(to_char(n, 'FM999,999,990'))
    else trim(to_char(n, 'FM999,999,990.00')) end
$$;

create or replace function public.norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case when d = '' then '' when d like '0%' then '254' || substr(d, 2) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;

-- Fix: to_char(..., 'FM...##') left a stray "." ("KES 1,000. weekly allowance").
create or replace function public.handle_spending_entry_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  a public.allowances%rowtype;
  v_spent numeric;
  v_old numeric;
begin
  v_user := coalesce(new.user_id, old.user_id);
  select * into a from public.allowances where user_id = v_user for update;
  if not found or a.weekly_amount <= 0 then return null; end if;

  if a.resets_at <= now() then
    a.resets_at := a.resets_at +
      (ceil(extract(epoch from (now() - a.resets_at)) / 604800.0)::int * interval '7 days');
  end if;

  select coalesce(sum(amount), 0) into v_spent
  from public.spending_entries
  where user_id = v_user
    and spent_at >= a.resets_at - interval '7 days'
    and spent_at <  a.resets_at;

  update public.allowances set resets_at = a.resets_at, spent_this_week = v_spent where id = a.id;

  if tg_op = 'INSERT'
     and new.spent_at >= a.resets_at - interval '7 days'
     and new.spent_at <  a.resets_at then
    v_old := v_spent - new.amount;
    if v_old < a.weekly_amount and v_spent >= a.weekly_amount then
      insert into public.notifications (user_id, title, body, type)
      values (v_user, 'Weekly allowance used up',
              'You have spent ' || public.fmt_kes(v_spent) || ' of your ' ||
              public.fmt_kes(a.weekly_amount) || ' weekly allowance.', 'allowance_exceeded');
    elsif v_old < a.weekly_amount * 0.8 and v_spent >= a.weekly_amount * 0.8 then
      insert into public.notifications (user_id, title, body, type)
      values (v_user, 'Allowance almost used',
              'You have used 80% of your ' || public.fmt_kes(a.weekly_amount) || ' weekly allowance.',
              'allowance_warning');
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.handle_spending_entry_change() from public, anon, authenticated;

-- ===== Feature 5: goal milestone notifications =====
create or replace function public.notify_goal_milestone()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old int; v_new int; v_t int;
begin
  if new.target_amount is null or new.target_amount <= 0 then return null; end if;
  v_old := floor(old.current_amount / new.target_amount * 100);
  v_new := floor(new.current_amount / new.target_amount * 100);
  -- only the highest milestone crossed by this change, so a big top-up doesn't send 3 alerts
  v_t := case
    when v_old < 100 and v_new >= 100 then 100
    when v_old < 75  and v_new >= 75  then 75
    when v_old < 50  and v_new >= 50  then 50
    when v_old < 25  and v_new >= 25  then 25
    else null end;
  if v_t is null then return null; end if;
  insert into public.notifications (user_id, title, body, type)
  values (new.user_id,
          case when v_t = 100 then 'Goal reached' else 'Goal ' || v_t || '% funded' end,
          format('"%s" is now %s%% funded (%s of %s).', left(new.name, 60), v_t,
                 public.fmt_kes(new.current_amount), public.fmt_kes(new.target_amount)),
          'goal_milestone');
  return null;
end;
$$;
revoke all on function public.notify_goal_milestone() from public, anon, authenticated;

drop trigger if exists savings_goals_milestone on public.savings_goals;
create trigger savings_goals_milestone
  after update of current_amount on public.savings_goals
  for each row when (new.current_amount > old.current_amount)
  execute function public.notify_goal_milestone();

-- ===== Feature 7: withdrawal protection =====
alter table public.profiles
  add column if not exists phone_changed_at timestamptz,
  add column if not exists daily_withdrawal_limit numeric(12,2),
  add column if not exists daily_limit_change_pending boolean not null default false,
  add column if not exists daily_limit_next numeric(12,2),
  add column if not exists daily_limit_next_at timestamptz;

alter table public.profiles
  add constraint profiles_daily_limit_positive check (daily_withdrawal_limit is null or daily_withdrawal_limit > 0),
  add constraint profiles_daily_limit_next_positive check (daily_limit_next is null or daily_limit_next > 0);

-- Users can edit their own profile row, so these protections live in a trigger:
--  * changing the payout phone starts a 24h withdrawal hold (stamp can't be reset by the client)
--  * lowering the daily limit applies immediately; raising/removing it only takes effect after 24h
--  * the client can cancel a pending change (always safe) but can never invent or fast-forward one
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_cur numeric; v_pend boolean; v_pval numeric; v_pat timestamptz;
begin
  if public.norm_phone(old.phone) <> ''
     and public.norm_phone(new.phone) is distinct from public.norm_phone(old.phone) then
    new.phone_changed_at := now();
  else
    new.phone_changed_at := old.phone_changed_at;
  end if;

  v_cur := old.daily_withdrawal_limit;
  v_pend := old.daily_limit_change_pending;
  v_pval := old.daily_limit_next;
  v_pat := old.daily_limit_next_at;
  if v_pend and v_pat <= now() then
    v_cur := v_pval; v_pend := false; v_pval := null; v_pat := null;
  end if;

  if v_pend and not new.daily_limit_change_pending then
    v_pend := false; v_pval := null; v_pat := null;
  end if;

  if new.daily_withdrawal_limit is not distinct from old.daily_withdrawal_limit then
    null;
  elsif new.daily_withdrawal_limit is not distinct from v_cur then
    v_pend := false; v_pval := null; v_pat := null;
  elsif new.daily_withdrawal_limit is not null and (v_cur is null or new.daily_withdrawal_limit < v_cur) then
    v_cur := new.daily_withdrawal_limit; v_pend := false; v_pval := null; v_pat := null;
  else
    if not (v_pend and v_pval is not distinct from new.daily_withdrawal_limit) then
      v_pend := true; v_pval := new.daily_withdrawal_limit; v_pat := now() + interval '24 hours';
    end if;
  end if;

  new.daily_withdrawal_limit := v_cur;
  new.daily_limit_change_pending := v_pend;
  new.daily_limit_next := v_pval;
  new.daily_limit_next_at := v_pat;
  return new;
end;
$$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

-- Single transactional entry point for starting a withdrawal. Takes a per-user
-- lock so two simultaneous requests can't both pass the balance check, and
-- counts still-pending withdrawals against balance and the daily limit.
create or replace function public.start_withdrawal(p_user_id uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  pr public.profiles%rowtype;
  v_balance numeric; v_pending numeric; v_limit numeric; v_used numeric; v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'ERR_AMOUNT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into pr from public.profiles where id = p_user_id;
  if not found or coalesce(pr.phone, '') = '' then raise exception 'ERR_NO_PHONE'; end if;

  if pr.phone_changed_at is not null and pr.phone_changed_at > now() - interval '24 hours' then
    raise exception 'ERR_PHONE_HOLD:%',
      to_char(((pr.phone_changed_at + interval '24 hours') at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  v_limit := case when pr.daily_limit_change_pending and pr.daily_limit_next_at <= now()
                  then pr.daily_limit_next else pr.daily_withdrawal_limit end;
  if v_limit is not null then
    select coalesce(sum(amount), 0) into v_used from public.ledger_transactions
    where user_id = p_user_id and type = 'withdrawal'
      and mpesa_transaction_status in ('pending', 'confirmed')
      and created_at > now() - interval '24 hours';
    if v_used + p_amount > v_limit then
      raise exception 'ERR_DAILY_LIMIT:%', greatest(v_limit - v_used, 0);
    end if;
  end if;

  select coalesce(balance, 0) into v_balance from public.akiba_balances where user_id = p_user_id;
  select coalesce(sum(amount), 0) into v_pending from public.ledger_transactions
    where user_id = p_user_id and type = 'withdrawal' and mpesa_transaction_status = 'pending';
  if coalesce(v_balance, 0) - v_pending < p_amount then raise exception 'ERR_INSUFFICIENT'; end if;

  insert into public.ledger_transactions (user_id, type, amount, mpesa_transaction_status, description)
  values (p_user_id, 'withdrawal', p_amount, 'pending', 'M-Pesa withdrawal')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.start_withdrawal(uuid, numeric) from public, anon, authenticated;
grant execute on function public.start_withdrawal(uuid, numeric) to service_role;

-- allocate_to_goal: same behaviour, plus the per-user lock (so it can't race a
-- withdrawal or auto-save) and pending withdrawals no longer count as spendable.
create or replace function public.allocate_to_goal(p_user_id uuid, p_goal_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_balance numeric; v_pending numeric;
begin
  if p_user_id <> auth.uid() then
    raise exception 'Not authorized to allocate funds for this account';
  end if;
  if p_amount <= 0 then
    raise exception 'Allocation amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select balance into v_balance from public.akiba_balances where user_id = p_user_id;
  select coalesce(sum(amount), 0) into v_pending from public.ledger_transactions
    where user_id = p_user_id and type = 'withdrawal' and mpesa_transaction_status = 'pending';
  if v_balance is null or v_balance - v_pending < p_amount then
    raise exception 'Insufficient AKIBA balance for allocation';
  end if;

  if not exists (select 1 from public.savings_goals where id = p_goal_id and user_id = p_user_id) then
    raise exception 'Goal not found';
  end if;

  insert into public.ledger_transactions (user_id, type, amount, mpesa_transaction_status, description)
  values (p_user_id, 'allocation', p_amount, 'confirmed', 'Allocated to savings goal ' || p_goal_id);

  update public.savings_goals
  set current_amount = current_amount + p_amount,
      completed = (current_amount + p_amount) >= target_amount
  where id = p_goal_id and user_id = p_user_id;
end;
$$;

-- ===== Feature 6: auto-save rules =====
create table if not exists public.auto_save_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  next_run_at timestamptz not null,
  active boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  unique (goal_id)
);
create index if not exists auto_save_rules_due_idx on public.auto_save_rules (next_run_at) where active;
alter table public.auto_save_rules enable row level security;

create policy auto_save_rules_select_own on public.auto_save_rules
  for select to authenticated using (auth.uid() = user_id);
create policy auto_save_rules_insert_own on public.auto_save_rules
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (select 1 from public.savings_goals g where g.id = goal_id and g.user_id = auth.uid()));
create policy auto_save_rules_update_own on public.auto_save_rules
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy auto_save_rules_delete_own on public.auto_save_rules
  for delete to authenticated using (auth.uid() = user_id);

-- Called by the daily cron (service role). Returns notification events for the
-- app to deliver (in-app + push) so the push logic stays in one place.
create or replace function public.run_auto_save_rules()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.auto_save_rules%rowtype;
  g public.savings_goals%rowtype;
  v_balance numeric; v_pending numeric; v_amt numeric; v_next timestamptz; v_step interval;
  v_status text; v_active boolean; n int;
  v_events jsonb := '[]'::jsonb;
begin
  for r in
    select * from public.auto_save_rules
    where active and next_run_at <= now()
    order by next_run_at
    for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(r.user_id::text, 0));

    v_step := case r.frequency when 'daily' then interval '1 day' when 'weekly' then interval '7 days'
                               else interval '1 month' end;
    -- skip missed periods rather than back-filling them
    v_next := r.next_run_at; n := 0;
    while v_next <= now() and n < 1000 loop v_next := v_next + v_step; n := n + 1; end loop;

    v_active := true;
    select * into g from public.savings_goals where id = r.goal_id and user_id = r.user_id for update;

    if not found or g.completed or g.target_amount - g.current_amount <= 0 then
      v_status := 'goal_complete'; v_active := false;
    else
      v_amt := least(r.amount, g.target_amount - g.current_amount);
      select coalesce(balance, 0) into v_balance from public.akiba_balances where user_id = r.user_id;
      select coalesce(sum(amount), 0) into v_pending from public.ledger_transactions
        where user_id = r.user_id and type = 'withdrawal' and mpesa_transaction_status = 'pending';

      if coalesce(v_balance, 0) - v_pending < v_amt then
        v_status := 'insufficient_balance';
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_id', r.user_id, 'type', 'auto_save_skipped',
          'title', 'Auto-save skipped',
          'body', 'Not enough AKIBA balance to save ' || public.fmt_kes(v_amt) || ' to "' || left(g.name, 60) || '". Top up to keep your streak.'));
      else
        insert into public.ledger_transactions (user_id, type, amount, mpesa_transaction_status, description)
        values (r.user_id, 'allocation', v_amt, 'confirmed', 'Auto-save to ' || left(g.name, 60));
        update public.savings_goals
           set current_amount = current_amount + v_amt,
               completed = (current_amount + v_amt) >= target_amount
         where id = g.id;
        v_status := 'ok';
        if g.current_amount + v_amt >= g.target_amount then v_active := false; end if;
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_id', r.user_id, 'type', 'auto_save',
          'title', 'Auto-saved ' || public.fmt_kes(v_amt),
          'body', 'Moved to "' || left(g.name, 60) || '" from your AKIBA balance.'));
      end if;
    end if;

    update public.auto_save_rules
       set next_run_at = v_next, last_run_at = now(), last_status = v_status, active = v_active
     where id = r.id;
  end loop;
  return v_events;
end;
$$;
revoke all on function public.run_auto_save_rules() from public, anon, authenticated;
grant execute on function public.run_auto_save_rules() to service_role;

-- ===== Feature 10: recurring deposit reminders =====
create table if not exists public.deposit_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  frequency text not null check (frequency in ('weekly', 'monthly')),
  day_of_week smallint check (day_of_week between 0 and 6),   -- 0 = Sunday
  day_of_month smallint check (day_of_month between 1 and 28),
  amount numeric(12,2) check (amount is null or (amount > 0 and amount <= 1000000)),
  active boolean not null default true,
  last_sent_on date,
  created_at timestamptz not null default now(),
  check ((frequency = 'weekly'  and day_of_week is not null and day_of_month is null)
      or (frequency = 'monthly' and day_of_month is not null and day_of_week is null))
);
alter table public.deposit_reminders enable row level security;

create policy deposit_reminders_select_own on public.deposit_reminders
  for select to authenticated using (auth.uid() = user_id);
create policy deposit_reminders_insert_own on public.deposit_reminders
  for insert to authenticated with check (auth.uid() = user_id);
create policy deposit_reminders_update_own on public.deposit_reminders
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy deposit_reminders_delete_own on public.deposit_reminders
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.run_deposit_reminders()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.deposit_reminders%rowtype;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_events jsonb := '[]'::jsonb;
begin
  for r in
    select * from public.deposit_reminders
    where active
      and last_sent_on is distinct from v_today
      and ((frequency = 'weekly'  and day_of_week  = extract(dow from v_today)::int)
        or (frequency = 'monthly' and day_of_month = extract(day from v_today)::int))
    for update skip locked
  loop
    update public.deposit_reminders set last_sent_on = v_today where id = r.id;
    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'user_id', r.user_id, 'type', 'deposit_reminder',
      'title', 'Time to top up your AKIBA',
      'body', case when r.amount is null then 'Add to your AKIBA balance to keep your goals on track.'
                   else 'Add ' || public.fmt_kes(r.amount) || ' to your AKIBA balance to keep your goals on track.' end));
  end loop;
  return v_events;
end;
$$;
revoke all on function public.run_deposit_reminders() from public, anon, authenticated;
grant execute on function public.run_deposit_reminders() to service_role;
