-- ============================================================
-- LifeOS migration — Alarms everywhere + anniversaries (birthdays)
-- Run ONCE in the Supabase SQL Editor for existing projects.
-- ============================================================

-- Per-item alarm sound choice
alter table public.reminders add column if not exists alarm_sound text;
alter table public.routine_tasks add column if not exists alarm_sound text;

-- Anniversary reminders on Remember items (birthdays, monthly dates)
alter table public.remember_items add column if not exists reminder_freq text
  check (reminder_freq in ('yearly','monthly') or reminder_freq is null);
alter table public.remember_items add column if not exists reminder_day date;
alter table public.remember_items add column if not exists reminder_note text;
alter table public.remember_items add column if not exists reminder_time time;

-- updated_at trigger for remember_items only if missing (it exists already
-- in projects created from schema.sql; guard against duplicates).
do $$ begin
  create trigger trg_remember_items_touch before update on public.remember_items
    for each row execute procedure public.touch_updated_at();
exception when others then null; end $$;
