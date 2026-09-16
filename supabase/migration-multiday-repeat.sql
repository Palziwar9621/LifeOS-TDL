-- ============================================================
-- Migration v2: multi-day routines + custom-day reminders (robust)
-- Run once in Supabase SQL Editor. Safe to re-run.
-- Fixes: v1 couldn't drop the auto-named check constraint, so
-- days-only routine rows were still rejected by the database.
-- ============================================================

-- 1) Columns (idempotent)
alter table public.routine_tasks add column if not exists days integer[];
alter table public.reminders add column if not exists recurrence_days integer[];

-- 2) Backfill days from legacy single weekday
update public.routine_tasks
set days = array[weekday]
where days is null and weekday is not null;

-- 3) Drop ANY check constraint on routine_tasks that blocks days-only rows.
--    The old one is auto-named (routine_tasks_weekday_extra_date_check or
--    routine_tasks_check or routine_tasks_<something>_check), so we find and
--    drop every check constraint on the table, then re-add one clean rule.
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
      and con.contype = 'c'   -- check constraints only
  loop
    execute format('alter table public.routine_tasks drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- 4) Re-add one clean, correctly-named rule:
--    a routine must have at least one of: weekday, extra_date, days
alter table public.routine_tasks
  add constraint routine_tasks_sched_check
  check (weekday is not null or extra_date is not null or days is not null);
