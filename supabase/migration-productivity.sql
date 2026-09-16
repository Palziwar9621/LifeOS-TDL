-- ============================================================
-- LifeOS migration — Productivity tab (daily routine + check-offs)
-- Run ONCE in the Supabase SQL Editor for existing projects.
-- (Fresh projects already get this from schema.sql.)
-- ============================================================

-- A repeating task for specific weekdays (or custom extra days).
-- weekday is 0=Sunday..6=Saturday; NULL weekday = only on extra_dates.
create table if not exists public.routine_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  weekday int check (weekday between 0 and 6),
  extra_date date,
  time_of_day time,
  color text not null default '#6366f1',
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (weekday is not null or extra_date is not null)
);
create index if not exists routine_tasks_user on public.routine_tasks(user_id);

-- One completion per task per day.
create table if not exists public.routine_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.routine_tasks(id) on delete cascade,
  done_date date not null,
  created_at timestamptz not null default now(),
  unique (task_id, done_date)
);
create index if not exists routine_completions_user on public.routine_completions(user_id);

-- RLS: owner-only access, same pattern as every other table.
alter table public.routine_tasks enable row level security;
alter table public.routine_completions enable row level security;
create policy "routine_tasks: all own" on public.routine_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "routine_completions: all own" on public.routine_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at touch triggers
create trigger trg_routine_tasks_touch before update on public.routine_tasks
  for each row execute procedure public.touch_updated_at();

-- Realtime sync across devices
alter table public.routine_tasks replica identity full;
alter table public.routine_completions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.routine_tasks;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.routine_completions;
exception when others then null; end $$;
