-- ============================================================
-- LifeOS — Supabase schema
-- Run this whole file in the Supabase SQL Editor, then enable
-- Realtime for the tables (Dashboard → Database → Replication).
-- All user-owned rows are protected by RLS: users only ever see
-- and modify rows where user_id = auth.uid().
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- PROFILES
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles: read own"    on public.profiles for select using (auth.uid() = id);
create policy "profiles: insert own"  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: update own"  on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
          new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- Shared column helpers (inlined per table for simplicity)
-- updated_at trigger
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- CATEGORIES (defaults seeded on first login)
-- ============================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index categories_user on public.categories(user_id);

-- ============================================================
-- TAGS
-- ============================================================
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index tags_user on public.tags(user_id);

-- ============================================================
-- PROJECTS
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active'
    check (status in ('idea','planning','active','on_hold','completed','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  color text not null default '#6366f1',
  start_date date,
  target_date date,
  completed_at timestamptz,
  archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user on public.projects(user_id);

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_milestones_project on public.project_milestones(project_id);

-- ============================================================
-- GOALS
-- ============================================================
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  horizon text not null default 'long_term'
    check (horizon in ('long_term','yearly','monthly','weekly')),
  deadline date,
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'active' check (status in ('active','completed','archived')),
  color text not null default '#6366f1',
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user on public.goals(user_id);

create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goal_milestones_goal on public.goal_milestones(goal_id);

-- ============================================================
-- TASKS
-- ============================================================
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'inbox'
    check (status in ('inbox','planned','in_progress','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date date,
  due_time time,
  start_time time,
  category_id uuid references public.categories(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  -- recurrence
  recurrence text check (recurrence in ('daily','weekdays','weekly','monthly','yearly','custom')),
  recurrence_days integer[],        -- 0=Sun..6=Sat, for weekly/custom
  recurrence_monthday integer,      -- 1..31 for monthly
  recurrence_anchor date,           -- series anchor date
  -- recurring completions: { "2026-09-16": true, ... }
  completed_occurrences jsonb not null default '{}'::jsonb,
  -- occurrence edits: { "2026-09-16": { "title": ..., "due_date": ..., "due_time": ..., "priority": ... } }
  occurrence_overrides jsonb not null default '{}'::jsonb,
  reminder_minutes integer,         -- minutes before due
  estimated_minutes integer,
  actual_minutes integer,
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_at_date date,
  archived boolean not null default false,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user on public.tasks(user_id);
create index tasks_due on public.tasks(user_id, due_date);
create index tasks_project on public.tasks(project_id);
create index tasks_goal on public.tasks(goal_id);

-- task ↔ tag link table
create table public.task_tags (
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, tag_id)
);
create index task_tags_tag on public.task_tags(tag_id);
alter table public.task_tags enable row level security;
create policy "task_tags: all own" on public.task_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- SUBTASKS
-- ============================================================
create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subtasks_task on public.subtasks(task_id);

-- ============================================================
-- NOTES
-- ============================================================
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  folder text,
  pinned boolean not null default false,
  favorite boolean not null default false,
  archived boolean not null default false,
  deleted boolean not null default false,
  tags text[] not null default '{}',
  linked_task_id uuid references public.tasks(id) on delete set null,
  linked_project_id uuid references public.projects(id) on delete set null,
  linked_goal_id uuid references public.goals(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user on public.notes(user_id);

-- ============================================================
-- IDEAS (future projects)
-- ============================================================
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  why text,
  notes text,
  links text,
  status text not null default 'idea'
    check (status in ('idea','someday','planned','ready_to_start','active','completed','abandoned')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  effort text check (effort in ('xs','s','m','l','xl')),
  possible_start date,
  target_date date,
  converted_project_id uuid references public.projects(id) on delete set null,
  photo_data text,
  voice_data text,
  voice_duration_secs int,
  archived boolean not null default false,
  deleted boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_user on public.ideas(user_id);

-- ============================================================
-- REMEMBER ITEMS (permanent things to remember)
-- ============================================================
create table public.remember_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '',
  category text,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  favorite boolean not null default false,
  deleted boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index remember_user on public.remember_items(user_id);

-- ============================================================
-- SCHEDULE BLOCKS (weekly planner — time allocated, not tasks)
-- ============================================================
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  weekday integer not null check (weekday between 0 and 6),  -- 0=Sunday..6=Saturday
  start_time time not null,
  end_time time not null,
  category_id uuid references public.categories(id) on delete set null,
  color text not null default '#6366f1',
  icon text,
  notes text,
  recurrence text not null default 'weekly'
    check (recurrence in ('weekly','even_weeks','odd_weeks','daily')),
  linked_task_id uuid references public.tasks(id) on delete set null,
  deleted boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schedule_blocks_user on public.schedule_blocks(user_id);

-- ============================================================
-- REMINDERS
-- ============================================================
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  due_at timestamptz not null,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  important boolean not null default false,
  done boolean not null default false,
  snoozed_until timestamptz,
  recurrence text check (recurrence in ('daily','weekdays','weekly','monthly','yearly') or recurrence is null),
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete cascade,
  deleted boolean not null default false,
  fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_user on public.reminders(user_id);
create index reminders_due on public.reminders(user_id, due_at);

-- ============================================================
-- FOCUS SESSIONS
-- ============================================================
create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  mode text not null default 'pomodoro' check (mode in ('pomodoro','custom')),
  duration_minutes integer not null,
  completed_minutes integer not null default 0,
  completed boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index focus_sessions_user on public.focus_sessions(user_id);

-- ============================================================
-- USER SETTINGS
-- ============================================================
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "settings: all own" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Enable RLS on all data tables (deny-all by default)
-- then allow full access only to the row owner.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'categories','tags','projects','project_milestones','goals','goal_milestones',
    'tasks','subtasks','notes','ideas','remember_items','schedule_blocks',
    'reminders','focus_sessions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s: all own" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- updated_at triggers on every table that has the column
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','categories','tags','projects','project_milestones','goals','goal_milestones',
    'tasks','subtasks','notes','ideas','remember_items','schedule_blocks','reminders'
  ]
  loop
    execute format(
      'create trigger trg_%s_touch before update on public.%I for each row execute procedure public.touch_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- REALTIME: enable full old-record payloads so the client can
-- see which fields changed. Then add tables to the publication.
-- ============================================================
alter table public.tasks replica identity full;
alter table public.notes replica identity full;
alter table public.goals replica identity full;
alter table public.projects replica identity full;
alter table public.subtasks replica identity full;
alter table public.reminders replica identity full;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','categories','tags','projects','project_milestones','goals','goal_milestones',
    'tasks','task_tags','subtasks','notes','ideas','remember_items','schedule_blocks',
    'reminders','focus_sessions','user_settings'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then
      -- table may already be in the publication
      null;
    end;
  end loop;
end $$;
