-- ============================================================
-- LifeOS migration — Idea instant capture (photo + voice)
-- Run this ONCE in the Supabase SQL Editor for existing projects.
-- (Fresh projects that run schema.sql don't need this — the columns
-- are already included there. Safe to run on any project: all
-- statements are idempotent.)
-- ============================================================

alter table public.ideas add column if not exists photo_data text;
alter table public.ideas add column if not exists voice_data text;
alter table public.ideas add column if not exists voice_duration_secs int;

-- Row Level Security already protects the whole row (including these
-- columns) via the existing ideas policies — nothing else to do.
