-- Applied to the AKIBA Supabase project via MCP on 2026-10-13 (migrations
-- `ledger_plan_payouts_and_sandbox_flag`, `start_withdrawal_keep_daily_limit_semantics`,
-- `step_up_lockout_functions`, `passkey_login_trusted_check`). Kept here so the repo
-- matches the database. Each part was crash-tested live inside rolled-back transactions.

-- 1) Allowance-plan payouts must not be deducted twice. Creating a plan already deducts
--    the full total as an 'allocation'; each later installment is a 'withdrawal' row (so
--    it shows in history and counts toward the daily limit) that must NOT reduce the
--    balance again. is_simulated marks sandbox payouts so only those can be auto-settled.
alter table public.ledger_transactions
  add column if not exists payout_schedule_id uuid references public.payout_schedules(id) on delete set null,
  add column if not exists is_simulated boolean not null default false;

create index if not exists ledger_payout_schedule_idx
  on public.ledger_transactions (payout_schedule_id) where payout_schedule_id is not null;
create index if not exists ledger_simulated_pending_idx
  on public.ledger_transactions (created_at) where is_simulated and mpesa_transaction_status = 'pending';

create or replace view public.akiba_balances with (security_invoker = true) as
select user_id,
       coalesce(sum(case
         when type = 'deposit'    and mpesa_transaction_status = 'confirmed' then amount
         when type = 'withdrawal' and mpesa_transaction_status = 'confirmed' and payout_schedule_id is null then - amount
         when type = 'allocation' and mpesa_transaction_status = 'confirmed' then - amount
         when type = 'spend'      and mpesa_transaction_status = 'confirmed' then - amount
         else 0::numeric end), 0::numeric)::numeric(12,2) as balance
from public.ledger_transactions
group by user_id;

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
    -- Plan payouts DO count toward the daily cash-out limit.
    select coalesce(sum(amount), 0) into v_used from public.ledger_transactions
    where user_id = p_user_id and type = 'withdrawal'
      and mpesa_transaction_status in ('pending', 'confirmed')
      and created_at > now() - interval '24 hours';
    if v_used + p_amount > v_limit then
      raise exception 'ERR_DAILY_LIMIT:%', greatest(v_limit - v_used, 0);
    end if;
  end if;

  select coalesce(balance, 0) into v_balance from public.akiba_balances where user_id = p_user_id;
  -- Pending plan payouts were already deducted when the plan was created, so they don't reserve balance.
  select coalesce(sum(amount), 0) into v_pending from public.ledger_transactions
    where user_id = p_user_id and type = 'withdrawal' and payout_schedule_id is null
      and mpesa_transaction_status = 'pending';
  if coalesce(v_balance, 0) - v_pending < p_amount then raise exception 'ERR_INSUFFICIENT'; end if;

  insert into public.ledger_transactions (user_id, type, amount, mpesa_transaction_status, description)
  values (p_user_id, 'withdrawal', p_amount, 'pending', 'M-Pesa withdrawal')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.start_withdrawal(uuid, numeric) from public, anon, authenticated;
grant execute on function public.start_withdrawal(uuid, numeric) to service_role;

-- 2) Brute-force protection for withdrawal PIN and TOTP. Server-only (service role).
--    5 wrong tries -> lock 15 min, doubling on each repeat lock (max 24h). Success resets.
create or replace function public.step_up_locked(p_user uuid, p_scope text)
returns timestamptz language sql security definer set search_path = '' as $$
  select locked_until from public.step_up_attempts
  where user_id = p_user and scope = p_scope and locked_until is not null and locked_until > now()
$$;

create or replace function public.step_up_fail(p_user uuid, p_scope text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.step_up_attempts%rowtype;
  v_max constant int := 5;
  v_until timestamptz;
begin
  if p_scope not in ('pin', 'totp') then raise exception 'bad scope'; end if;
  insert into public.step_up_attempts (user_id, scope) values (p_user, p_scope) on conflict do nothing;
  select * into r from public.step_up_attempts where user_id = p_user and scope = p_scope for update;

  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('locked_until', r.locked_until, 'remaining', 0);
  end if;

  r.failed_attempts := r.failed_attempts + 1;
  if r.failed_attempts >= v_max then
    r.lock_count := r.lock_count + 1;
    v_until := now() + least(interval '15 minutes' * power(2, r.lock_count - 1), interval '24 hours');
    update public.step_up_attempts
       set failed_attempts = 0, lock_count = r.lock_count, locked_until = v_until, updated_at = now()
     where user_id = p_user and scope = p_scope;
    return jsonb_build_object('locked_until', v_until, 'remaining', 0);
  end if;

  update public.step_up_attempts
     set failed_attempts = r.failed_attempts, updated_at = now()
   where user_id = p_user and scope = p_scope;
  return jsonb_build_object('locked_until', null, 'remaining', v_max - r.failed_attempts);
end;
$$;

create or replace function public.step_up_ok(p_user uuid, p_scope text)
returns void language sql security definer set search_path = '' as $$
  update public.step_up_attempts
     set failed_attempts = 0, lock_count = 0, locked_until = null, updated_at = now()
   where user_id = p_user and scope = p_scope
$$;

revoke all on function public.step_up_locked(uuid, text) from public, anon, authenticated;
revoke all on function public.step_up_fail(uuid, text) from public, anon, authenticated;
revoke all on function public.step_up_ok(uuid, text) from public, anon, authenticated;
grant execute on function public.step_up_locked(uuid, text) to service_role;
grant execute on function public.step_up_fail(uuid, text) to service_role;
grant execute on function public.step_up_ok(uuid, text) to service_role;

-- Hardening from the security advisor: trigger-only / helper functions must not be RPC-callable.
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
alter function public.set_updated_at() set search_path = '';

-- 3) True only if the passkey the user JUST signed in with (last_used_at within 3 min) was
--    enrolled at least 24h ago. Lets a passkey login skip TOTP without letting someone who
--    only has a stolen password enrol their own passkey and use it straight away.
create or replace function public.passkey_login_trusted(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.webauthn_credentials c
    where c.user_id = p_user
      and c.last_used_at is not null
      and c.last_used_at > now() - interval '3 minutes'
      and c.created_at < now() - interval '24 hours'
  )
$$;
revoke all on function public.passkey_login_trusted(uuid) from public, anon, authenticated;
grant execute on function public.passkey_login_trusted(uuid) to service_role;
