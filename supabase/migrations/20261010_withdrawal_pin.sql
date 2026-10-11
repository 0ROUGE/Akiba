-- Withdrawal PIN + step-up attempt throttling (server-side only).
-- Clients have NO direct access to either table: every read/write goes
-- through Next.js route handlers using the service role.

create table if not exists public.withdrawal_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.withdrawal_pins enable row level security;
revoke all on public.withdrawal_pins from anon, authenticated;

create table if not exists public.step_up_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('pin', 'totp')),
  failed_attempts int not null default 0,
  lock_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);
alter table public.step_up_attempts enable row level security;
revoke all on public.step_up_attempts from anon, authenticated;

-- Reserve an attempt BEFORE checking the secret. Because the reservation is
-- a single row-locked UPDATE, a burst of parallel guesses can't all squeeze
-- through before the lock engages — each one consumes an attempt atomically.
-- 5 attempts, then a lock of 15m, doubling per lock up to 24h. After a lock
-- expires the user gets 2 more attempts before it re-locks (escalated).
create or replace function public.begin_step_up_attempt(p_user uuid, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.step_up_attempts%rowtype;
  v_dur interval;
  v_until timestamptz;
begin
  if p_scope not in ('pin', 'totp') then raise exception 'bad scope'; end if;
  insert into public.step_up_attempts (user_id, scope) values (p_user, p_scope) on conflict do nothing;
  select * into r from public.step_up_attempts where user_id = p_user and scope = p_scope for update;

  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'locked_until', r.locked_until);
  end if;

  r.failed_attempts := r.failed_attempts + 1;
  if r.failed_attempts >= 5 then
    v_dur := least(interval '24 hours', interval '15 minutes' * power(2, r.lock_count));
    v_until := now() + v_dur;
    update public.step_up_attempts
       set failed_attempts = 3, lock_count = lock_count + 1, locked_until = v_until, updated_at = now()
     where user_id = p_user and scope = p_scope;
    -- this attempt itself still gets evaluated; the lock bites the next one
    return jsonb_build_object('status', 'ok', 'attempts_left', 0, 'locked_until', v_until);
  end if;

  update public.step_up_attempts set failed_attempts = r.failed_attempts, updated_at = now()
   where user_id = p_user and scope = p_scope;
  return jsonb_build_object('status', 'ok', 'attempts_left', 5 - r.failed_attempts);
end;
$$;

create or replace function public.reset_step_up_attempts(p_user uuid, p_scope text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.step_up_attempts
     set failed_attempts = 0, lock_count = 0, locked_until = null, updated_at = now()
   where user_id = p_user and scope = p_scope;
$$;

create or replace function public.set_withdrawal_pin(p_user uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_hash is null or length(p_hash) < 20 then raise exception 'bad hash'; end if;
  insert into public.withdrawal_pins (user_id, pin_hash) values (p_user, p_hash)
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  perform public.reset_step_up_attempts(p_user, 'pin');
end;
$$;

-- service role only
revoke all on function public.begin_step_up_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.reset_step_up_attempts(uuid, text) from public, anon, authenticated;
revoke all on function public.set_withdrawal_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_step_up_attempt(uuid, text) to service_role;
grant execute on function public.reset_step_up_attempts(uuid, text) to service_role;
grant execute on function public.set_withdrawal_pin(uuid, text) to service_role;
