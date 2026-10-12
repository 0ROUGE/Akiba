-- Applied to the AKIBA Supabase project via MCP on 2026-10-11.
-- Lets the app show an instant "transaction successful" screen when a deposit /
-- withdrawal is confirmed. Realtime respects the existing RLS select policy, so
-- each user only ever receives their own rows.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ledger_transactions'
  ) then
    alter publication supabase_realtime add table public.ledger_transactions;
  end if;
end $$;
