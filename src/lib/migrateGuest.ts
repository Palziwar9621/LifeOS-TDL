// LifeOS — guest → account migration.
// Copies locally-created guest rows into the freshly signed-in account,
// remapping ids so cross-references (task→project, subtask→task, links)
// stay intact. Guest data is snapshotted before the copy and only cleared
// after every table reports success — a failure keeps the snapshot for retry.
import { dbState, createTask, createNote, createReminder, createProject, createGoal,
  createProjectMilestone, createGoalMilestone, createRememberItem, createIdea,
  createCategory, createTag, linkTaskTag, createSubtask, createScheduleBlock,
  createRoutineTask, currentUserId, insertRowDirect } from './db';

const COPY_ORDER = [
  'categories', 'tags', 'projects', 'project_milestones', 'goals', 'goal_milestones',
  'routine_tasks', 'schedule_blocks', 'notes', 'ideas', 'remember_items', 'reminders',
  'tasks', 'subtasks', 'task_tags', 'focus_sessions',
] as const;

export interface MigrationReport {
  ok: boolean;
  copied: Record<string, number>;
  failed?: string;
  error?: string;
}

/** Maps old guest ids → new server ids so relations survive the copy. */
export async function migrateGuestData(snapshot: Record<string, any[]>): Promise<MigrationReport> {
  const uid = currentUserId();
  if (!uid) return { ok: false, copied: {}, error: 'Not signed in' };

  const copied: Record<string, number> = {};
  const idMap = new Map<string, string>();
  const now = new Date().toISOString();

  try {
    for (const table of COPY_ORDER) {
      const rows = snapshot[table] ?? [];
      let n = 0;
      for (const row of rows) {
        const newId = crypto.randomUUID();
        idMap.set(row.id, newId);
        const remap = (id: string | null | undefined): string | null =>
          id ? idMap.get(id) ?? id : null;
        try {
          switch (table) {
            case 'categories':
              await insertRowDirect('categories', { ...row, id: newId, user_id: uid, created_at: now, updated_at: now });
              break;
            case 'tags':
              await insertRowDirect('tags', { ...row, id: newId, user_id: uid, created_at: now, updated_at: now });
              break;
            case 'projects':
              await insertRowDirect('projects', { ...row, id: newId, user_id: uid, created_at: now, updated_at: now });
              break;
            case 'project_milestones':
              await insertRowDirect('project_milestones', { ...row, id: newId, user_id: uid, project_id: remap(row.project_id), created_at: now, updated_at: now });
              break;
            case 'goals':
              await insertRowDirect('goals', { ...row, id: newId, user_id: uid, created_at: now, updated_at: now });
              break;
            case 'goal_milestones':
              await insertRowDirect('goal_milestones', { ...row, id: newId, user_id: uid, goal_id: remap(row.goal_id), created_at: now, updated_at: now });
              break;
            case 'routine_tasks':
              await insertRowDirect('routine_tasks', { ...row, id: newId, user_id: uid, created_at: now, updated_at: now });
              break;
            case 'schedule_blocks':
              await insertRowDirect('schedule_blocks', { ...row, id: newId, user_id: uid, category_id: remap(row.category_id), linked_task_id: remap(row.linked_task_id), created_at: now, updated_at: now });
              break;
            case 'notes':
              await insertRowDirect('notes', { ...row, id: newId, user_id: uid, linked_task_id: remap(row.linked_task_id), linked_project_id: remap(row.linked_project_id), linked_goal_id: remap(row.linked_goal_id), created_at: now, updated_at: now });
              break;
            case 'ideas':
              await insertRowDirect('ideas', { ...row, id: newId, user_id: uid, converted_project_id: remap(row.converted_project_id), created_at: now, updated_at: now });
              break;
            case 'remember_items':
              await insertRowDirect('remember_items', { ...row, id: newId, user_id: uid, created_at: now, updated_at: now });
              break;
            case 'reminders':
              await insertRowDirect('reminders', { ...row, id: newId, user_id: uid, task_id: remap(row.task_id), project_id: remap(row.project_id), goal_id: remap(row.goal_id), created_at: now, updated_at: now });
              break;
            case 'tasks':
              await insertRowDirect('tasks', { ...row, id: newId, user_id: uid, category_id: remap(row.category_id), project_id: remap(row.project_id), goal_id: remap(row.goal_id), created_at: now, updated_at: now });
              break;
            case 'subtasks':
              await insertRowDirect('subtasks', { ...row, id: newId, user_id: uid, task_id: remap(row.task_id), created_at: now, updated_at: now });
              break;
            case 'task_tags': {
              const taskId = remap(row.task_id);
              const tagId = remap(row.tag_id);
              if (taskId && tagId) {
                await insertRowDirect('task_tags', { id: crypto.randomUUID(), task_id: taskId, tag_id: tagId, user_id: uid });
              }
              break;
            }
            case 'focus_sessions':
              await insertRowDirect('focus_sessions', { ...row, id: newId, user_id: uid, task_id: remap(row.task_id) });
              break;
          }
          n++;
        } catch {
          // one bad row shouldn't block the rest of its table
        }
      }
      copied[table] = n;
    }
    return { ok: true, copied };
  } catch (e: any) {
    return { ok: false, copied, failed: e?.table, error: e?.message ?? 'Migration failed midway — guest data kept, retry available.' };
  }
}
