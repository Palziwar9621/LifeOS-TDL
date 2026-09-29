-- Migration: add tag_ids to tasks (2026-09-29)
-- Fixes: "Could not find the 'tag_ids' column of 'tasks' in the schema cache"
-- The client (src/lib/db.ts createTask) writes tag_ids on every task row;
-- without this column ALL task inserts/updates fail to sync to Supabase.
-- Idempotent — safe to run more than once.

alter table public.tasks
  add column if not exists tag_ids text[] not null default '{}';

-- keep the REST schema cache fresh (harmless if already reloaded)
notify pgrst, 'reload schema';

-- backfill the join-table links into the array column for any existing rows
update public.tasks t
set tag_ids = coalesce(
  (select array_agg(tt.tag_id::text order by tt.tag_id)
   from public.task_tags tt
   where tt.task_id = t.id),
  '{}'
)
where t.tag_ids = '{}'
  and exists (select 1 from public.task_tags tt where tt.task_id = t.id);
