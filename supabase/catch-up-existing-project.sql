-- ============================================================
-- LifeOS — ONE-TIME CATCH-UP for existing databases
-- Adds everything the app expects if you created your project
-- before the newer features shipped. Safe to run more than once.
-- Run in Supabase → SQL Editor → paste everything → Run.
-- ============================================================

-- ---------- 1) Idea capture: photo + voice ----------
alter table public.ideas add column if not exists photo_data text;
alter table public.ideas add column if not exists voice_data text;

-- ---------- 2) Productivity: routine tables ----------
create table if not exists public.routine_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  weekday int check (weekday between 0 and 6),
  days integer[],
  extra_date date,
  time_of_day time,
  color text not null default '#6366f1',
  alarm_sound text,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routine_tasks_user on public.routine_tasks(user_id);

create table if not exists public.routine_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.routine_tasks(id) on delete cascade,
  done_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists routine_completions_user on public.routine_completions(user_id);

-- ---------- 3) Alarms + anniversaries ----------
alter table public.reminders  add column if not exists alarm_sound text;
alter table public.routine_tasks add column if not exists alarm_sound text;

alter table public.remember_items add column if not exists reminder_freq text check (reminder_freq in ('yearly','monthly') or reminder_freq is null);
alter table public.remember_items add column if not exists reminder_day date;
alter table public.remember_items add column if not exists reminder_time text;
alter table public.remember_items add column if not exists reminder_note text;

-- ---------- 4) Multi-weekday repeat ----------
alter table public.reminders add column if not exists recurrence_days integer[];

-- Backfill routine days from legacy single weekday
update public.routine_tasks
set days = array[weekday]
where days is null and weekday is not null;

-- Drop any check constraint on routine_tasks that forbids days-only rows,
-- then re-add one clean rule (weekday OR extra_date OR days).
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'routine_tasks'
      and nsp.nspname = 'public'
      and con.contype = 'c'
  loop
    execute format('alter table public.routine_tasks drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.routine_tasks
  add constraint routine_tasks_sched_check
  check (weekday is not null or extra_date is not null or days is not null);

-- ---------- 5) RLS for the newer tables ----------
alter table public.routine_tasks enable row level security;
alter table public.routine_completions enable row level security;
drop policy if exists "routine_tasks: all own" on public.routine_tasks;
drop policy if exists "routine_completions: all own" on public.routine_completions;
create policy "routine_tasks: all own" on public.routine_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "routine_completions: all own" on public.routine_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 6) updated_at triggers (only if missing) ----------
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists routine_tasks_touch on public.routine_tasks;
create trigger routine_tasks_touch
  before update on public.routine_tasks
  for each row execute function public.touch_updated_at();

-- ---------- 7) Realtime for the newer tables ----------
do $$
begin
  alter publication supabase_realtime add table public.routine_tasks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.routine_completions;
exception
  when duplicate_object then null;
end $$;
