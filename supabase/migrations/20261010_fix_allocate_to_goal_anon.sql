-- SECURITY FIX. allocate_to_goal() checked `p_user_id <> auth.uid()`. For an
-- unauthenticated caller auth.uid() is NULL, so the comparison is NULL, the
-- IF never fired, and the check was silently skipped. The function was also
-- executable by `anon` (the public key shipped in every browser bundle), so
-- anyone who knew a user's id and goal id could move that user's balance
-- into the goal. Verified exploitable inside a rolled-back transaction before
-- fixing. Body is otherwise identical to the live version (advisory lock +
-- pending-withdrawal-aware balance check).
create or replace function public.allocate_to_goal(p_user_id uuid, p_goal_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance numeric; v_pending numeric;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Not authorized to allocate funds for this account';
  end if;
  if p_amount is null or p_amount <= 0 then
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
$function$;

revoke all on function public.allocate_to_goal(uuid, uuid, numeric) from public, anon;
grant execute on function public.allocate_to_goal(uuid, uuid, numeric) to authenticated;
