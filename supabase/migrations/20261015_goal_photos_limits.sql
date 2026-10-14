-- Applied to the AKIBA Supabase project via MCP on 2026-10-15 (migrations
-- `goal_photos_limits_and_sms_cap`, `avatars_bucket_hardening`, then `lock_goal_columns`
-- after the matching code shipped). Crash-tested live in rolled-back transactions.

-- ===== A) Goal photos, creation limits, daily SMS cap =====
alter table public.savings_goals add column if not exists photo_url text;
alter table public.savings_goals
  add constraint savings_goals_name_len check (char_length(name) between 1 and 80);
alter table public.savings_goals
  add constraint savings_goals_photo_len check (photo_url is null or char_length(photo_url) <= 500);

-- Creating a goal sends an SMS, so unlimited goal creation from a browser is a way to burn SMS credit.
create or replace function public.savings_goals_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.savings_goals where user_id = new.user_id and not completed) >= 50 then
    raise exception 'ERR_GOAL_LIMIT';
  end if;
  if (select count(*) from public.savings_goals where user_id = new.user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'ERR_GOAL_RATE';
  end if;
  return new;
end;
$$;
revoke all on function public.savings_goals_limits() from public, anon, authenticated;
drop trigger if exists savings_goals_limits_trg on public.savings_goals;
create trigger savings_goals_limits_trg before insert on public.savings_goals
  for each row execute function public.savings_goals_limits();

-- Daily SMS cap per user: one account can't send more than 20 texts in 24 hours. The row is still
-- recorded (as 'skipped') so it's visible why.
create or replace function public.queue_sms_for_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pr public.profiles%rowtype; v_phone text; v_ok boolean; v_default boolean; v_pref jsonb; v_on boolean;
  v_recent int; v_capped boolean; v_status text; v_err text;
begin
  select * into pr from public.profiles where id = new.user_id;
  if not found or not pr.sms_enabled then return null; end if;

  v_default := new.type <> 'monthly_summary';
  v_pref := pr.notification_prefs #> array['sms', new.type];
  v_on := case when jsonb_typeof(v_pref) = 'boolean' then (v_pref)::text::boolean else v_default end;
  if not v_on then return null; end if;

  v_phone := public.norm_phone(pr.phone);
  v_ok := v_phone ~ '^254[17][0-9]{8}$';

  select count(*) into v_recent from public.sms_outbox
   where user_id = new.user_id and created_at > now() - interval '24 hours'
     and status in ('pending', 'sending', 'sent');
  v_capped := v_recent >= 20;

  v_status := case when v_ok and not v_capped then 'pending' else 'skipped' end;
  v_err := case when not v_ok then 'invalid or missing phone' when v_capped then 'daily sms cap reached' else null end;

  insert into public.sms_outbox (user_id, notification_id, type, message, status, last_error)
  values (new.user_id, new.id, new.type,
          left('AKIBA: ' || new.title || coalesce('. ' || new.body, ''), 160), v_status, v_err)
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.queue_sms_for_notification() from public, anon, authenticated;

-- ===== B) Avatars bucket (profile + goal photos) =====
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif']
 where id = 'avatars';

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects for delete
  using (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);

-- ===== C) Goal progress can't be faked from a browser =====
-- Browsers could write current_amount / completed directly. Money moves through the
-- allocate_to_goal() function; browsers may only create goals and edit their details.
revoke insert, update on public.savings_goals from anon, authenticated;
grant insert (user_id, name, target_amount, target_date, photo_url) on public.savings_goals to authenticated;
grant update (name, target_amount, target_date, photo_url) on public.savings_goals to authenticated;
