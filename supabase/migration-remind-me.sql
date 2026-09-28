-- ============================================================
-- LifeOS — per-task reminder on/off
-- Voice: "remind me about X" / "don't remind me about X".
-- Run in Supabase → SQL Editor → paste → Run. Idempotent.
-- ============================================================
alter table public.tasks add column if not exists remind_me boolean default true;
