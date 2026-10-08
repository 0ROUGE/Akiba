-- Applied to the AKIBA Supabase project via MCP on 2026-10-08.
-- Kept here so the repo matches the database.

-- Self-reported spending log. Deliberately separate from ledger_transactions:
-- AKIBA can't see what the user spends outside the app, so these rows never
-- move the AKIBA balance.
create table if not exists public.spending_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  category text not null check (category in
    ('food','transport','airtime_data','bills','shopping','health','entertainment','education','other')),
  note text check (note is null or char_length(note) <= 120),
  spent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists spending_entries_user_spent_idx
  on public.spending_entries (user_id, spent_at desc);

alter table public.spending_entries enable row level security;

create policy spending_entries_select_own on public.spending_entries
  for select to authenticated using (auth.uid() = user_id);
create policy spending_entries_insert_own on public.spending_entries
  for insert to authenticated with check (auth.uid() = user_id);
create policy spending_entries_delete_own on public.spending_entries
  for delete to authenticated using (auth.uid() = user_id);

-- One allowance per user.
create unique index if not exists allowances_user_id_key on public.allowances (user_id);

-- Keeps allowances.spent_this_week in sync and raises in-app notifications
-- when spending crosses 80% and 100% of the weekly allowance.
create or replace function public.handle_spending_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  a public.allowances%rowtype;
  v_spent numeric;
  v_old numeric;
begin
  v_user := coalesce(new.user_id, old.user_id);

  select * into a from public.allowances where user_id = v_user for update;
  if not found or a.weekly_amount <= 0 then
    return null;
  end if;

  -- Roll the weekly window forward if it has lapsed.
  if a.resets_at <= now() then
    a.resets_at := a.resets_at +
      (ceil(extract(epoch from (now() - a.resets_at)) / 604800.0)::int * interval '7 days');
  end if;

  select coalesce(sum(amount), 0) into v_spent
  from public.spending_entries
  where user_id = v_user
    and spent_at >= a.resets_at - interval '7 days'
    and spent_at <  a.resets_at;

  update public.allowances
     set resets_at = a.resets_at, spent_this_week = v_spent
   where id = a.id;

  if tg_op = 'INSERT'
     and new.spent_at >= a.resets_at - interval '7 days'
     and new.spent_at <  a.resets_at then
    v_old := v_spent - new.amount;
    if v_old < a.weekly_amount and v_spent >= a.weekly_amount then
      insert into public.notifications (user_id, title, body, type)
      values (v_user, 'Weekly allowance used up',
              'You have spent KES ' || trim(to_char(v_spent, 'FM999,999,990.##')) ||
              ' of your KES ' || trim(to_char(a.weekly_amount, 'FM999,999,990.##')) || ' weekly allowance.',
              'allowance_exceeded');
    elsif v_old < a.weekly_amount * 0.8 and v_spent >= a.weekly_amount * 0.8 then
      insert into public.notifications (user_id, title, body, type)
      values (v_user, 'Allowance almost used',
              'You have used 80% of your KES ' ||
              trim(to_char(a.weekly_amount, 'FM999,999,990.##')) || ' weekly allowance.',
              'allowance_warning');
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.handle_spending_entry_change() from public, anon, authenticated;

drop trigger if exists spending_entries_after_change on public.spending_entries;
create trigger spending_entries_after_change
  after insert or delete on public.spending_entries
  for each row execute function public.handle_spending_entry_change();
