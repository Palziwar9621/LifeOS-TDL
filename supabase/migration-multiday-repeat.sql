-- ============================================================
-- Migration: multi-day routines + custom-day reminders
-- Run once in Supabase SQL Editor (safe to re-run).
-- ============================================================

-- Routine tasks: repeat on multiple weekdays (0=Sun..6=Sat)
alter table public.routine_tasks add column if not exists days integer[];

-- Reminders: custom weekday repeat (for weekly/custom recurrence)
alter table public.reminders add column if not exists recurrence_days integer[];

-- Backfill: routine rows with only weekday set get days = [weekday]
update public.routine_tasks
set days = array[weekday]
where days is null and weekday is not null;

-- Loosen the old check (weekday OR extra_date is not null) to allow days-only rows
alter table public.routine_tasks drop constraint if exists routine_tasks_weekday_extra_date_check;
alter table public.routine_tasks drop constraint if exists routine_tasks_check;

-- Re-add a permissive check: at least one scheduling field present
alter table public.routine_tasks
  add constraint routine_tasks_sched_check
  check (weekday is not null or extra_date is not null or days is not null);
