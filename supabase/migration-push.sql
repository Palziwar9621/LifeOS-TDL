-- ============================================================
-- LifeOS — push subscriptions + scheduled push (works with app closed)
-- Run in Supabase → SQL Editor → paste everything → Run. Idempotent.
-- ============================================================

-- 1) One row per device subscription.
create table if not exists public.push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subs: all own" on public.push_subscriptions;
create policy "push_subs: all own" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) One-time alarm fire tracking (so the cron doesn't push the same item twice).
create table if not exists public.alarm_fires (
  key text primary key,           -- e.g. 'rem:<id>:<due_at>' or 'routine:<id>:<date>'
  fired_at timestamptz not null default now()
);
alter table public.alarm_fires enable row level security;
-- Service role only (used by the Edge Function); no client policies on purpose.

-- Keep it tidy: forget fires older than 2 days.
create or replace function public.prune_alarm_fires()
returns void as $$
  delete from public.alarm_fires where fired_at < now() - interval '2 days';
$$ language sql;

-- 3) Cron: run send-push every minute (uses pg_cron, preinstalled on Supabase).
-- NOTE: you must set the function secrets first (see README):
--   supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... PUSH_FN_URL=... PUSH_SERVICE_ROLE_KEY=...
create or replace function public.trigger_send_push()
returns void as $$
declare
  project_url text;
  service_role_key text;
begin
  -- Vault or settings-based lookup; falls back to well-known env names.
  begin
    select decrypted_secret into service_role_key from vault.decrypted_secrets
      where name = 'service_role_key' limit 1;
  exception when others then service_role_key := null;
  end;
  begin
    select decrypted_secret into project_url from vault.decrypted_secrets
      where name = 'project_url' limit 1;
  exception when others then project_url := null;
  end;

  if service_role_key is null or project_url is null then
    raise notice 'trigger_send_push: vault secrets project_url / service_role_key not set; skipping';
    return;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('scheduled', true)
  );
end;
$$ language plpgsql security definer;

-- Schedule with pg_cron (every minute). Safe to re-run (drops then recreates).
create extension if not exists pg_cron;
select cron.unschedule('lifeos-send-push') where exists (
  select 1 from cron.job where jobname = 'lifeos-send-push'
);
select cron.schedule('lifeos-send-push', '* * * * *', $$select public.trigger_send_push();$$);

select public.prune_alarm_fires();
