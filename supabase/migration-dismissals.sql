-- ============================================================
-- LifeOS — cross-device alarm dismissal tracking
-- When a user turns off / dismisses an alarm on ANY device, the key is
-- recorded here; every other device checks this table before ringing,
-- so a stopped alarm never rings again (on any device) until its next
-- scheduled occurrence (keys embed the occurrence timestamp, so a new
-- occurrence = a new key = it rings again naturally).
-- Run in Supabase → SQL Editor → paste everything → Run. Idempotent.
-- ============================================================

create table if not exists public.alarm_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.alarm_dismissals enable row level security;
drop policy if exists "alarm_dismissals: all own" on public.alarm_dismissals;
create policy "alarm_dismissals: all own" on public.alarm_dismissals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep it tidy: forget dismissals older than 2 days (keys embed occurrence
-- time, so anything older can never match a future ring anyway).
create or replace function public.prune_alarm_dismissals()
returns void as $$
  delete from public.alarm_dismissals where dismissed_at < now() - interval '2 days';
$$ language sql;
