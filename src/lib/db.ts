// LifeOS — local-first data store.
// All mutations apply to an in-memory DB immediately, persist to IndexedDB,
// enqueue an outbox op, and flush to Supabase when online. Pull + realtime
// converge all devices. Last-write-wins per row via updated_at.
import type {
  Category, EntityKind, FocusSession, Goal, GoalMilestone, Idea, Note,
  Profile, Project, ProjectMilestone, RememberItem, Reminder, ScheduleBlock,
  Subtask, Tag, Task, TaskStatus, Priority,
} from './types';
import { idbGet, idbSet, cacheKey, idbWipeUser } from './idb';
import { getClient } from './supabase';
import { loadOutbox, pushOp, markFlushed, bumpAttempt, type OutboxOp } from './outbox';
import { todayStr } from './dates';

/** Demo mode (#demo): no Supabase, purely local — used for previews and trials. */
export const DEMO = typeof window !== 'undefined' && window.location.hash === '#demo';

type Row = { id: string; updated_at?: string | null; user_id?: string; [k: string]: any };
type Table = EntityKind | 'user_settings' | 'profiles';

export interface DBState {
  profiles: Profile[];
  categories: Category[];
  tags: Tag[];
  projects: Project[];
  project_milestones: ProjectMilestone[];
  goals: Goal[];
  goal_milestones: GoalMilestone[];
  tasks: Task[];
  subtasks: Subtask[];
  task_tags: { task_id: string; tag_id: string; user_id: string }[];
  notes: Note[];
  ideas: Idea[];
  remember_items: RememberItem[];
  schedule_blocks: ScheduleBlock[];
  reminders: Reminder[];
  focus_sessions: FocusSession[];
  user_settings: { user_id: string; data: Record<string, any> } | null;
}

const emptyState = (): DBState => ({
  profiles: [], categories: [], tags: [], projects: [], project_milestones: [],
  goals: [], goal_milestones: [], tasks: [], subtasks: [], task_tags: [],
  notes: [], ideas: [], remember_items: [], schedule_blocks: [],
  reminders: [], focus_sessions: [], user_settings: null,
});

let state: DBState = emptyState();
let uid: string | null = null;
let version = 0;
let flushing = false;
let pulling = false;
let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
let outboxSeq = Math.floor(Date.now() / 1000);
let outbox: OutboxOp[] = [];
let listeners: Array<() => void> = [];
let realtimeChannel: any = null;
let toastFn: ((msg: string, kind?: 'info' | 'error' | 'success') => void) | null = null;
let pullTimer: any = null;

export function setToastFn(fn: typeof toastFn) { toastFn = fn; }
function toast(msg: string, kind: 'info' | 'error' | 'success' = 'info') {
  if (toastFn) toastFn(msg, kind);
}

function emit() { version++; listeners.forEach((l) => l()); }
export function subscribeDb(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
export function getDbVersion() { return version; }
export function getOutboxCount() { return outbox.filter((o) => !o.dead).length; }
export function getOnline() { return online; }
export function currentUserId() { return uid; }

// ------------------------------------------------------------------
// Boot / teardown
// ------------------------------------------------------------------
export async function initStore(userId: string): Promise<void> {
  uid = userId;
  state = emptyState();
  outbox = [];
  const tables: Table[] = [
    'profiles', 'categories', 'tags', 'projects', 'project_milestones', 'goals',
    'goal_milestones', 'tasks', 'subtasks', 'task_tags', 'notes', 'ideas',
    'remember_items', 'schedule_blocks', 'reminders', 'focus_sessions',
  ];
  for (const t of tables) {
    const cached = await idbGet<any[]>(cacheKey(userId, t));
    if (cached) (state as any)[t] = cached;
  }
  const cachedSettings = await idbGet<any>(cacheKey(userId, 'user_settings'));
  if (cachedSettings) state.user_settings = cachedSettings;
  const cachedOutbox = await idbGet<OutboxOp[]>('outbox');
  if (cachedOutbox) outbox = cachedOutbox;
  emit();
  await pull();
  await seedDefaults();
  subscribeRealtime();
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = setInterval(() => { if (online) void flush(); }, 60000);
}

export async function resetStore() {
  if (uid) await idbWipeUser(uid + ':');
  if (realtimeChannel) {
    const sb = getClient();
    if (sb) sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  state = emptyState();
  outbox = [];
  uid = null;
  emit();
}

function handleOnline() {
  online = true;
  emit();
  toast('Back online — syncing…', 'info');
  void flush();
}
function handleOffline() {
  online = false;
  emit();
  toast('Offline — changes will sync when you reconnect.', 'info');
}

// ------------------------------------------------------------------
// Realtime
// ------------------------------------------------------------------
function subscribeRealtime() {
  const sb = getClient();
  if (DEMO || !sb || !uid) return;
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  const tables: Table[] = [
    'profiles', 'categories', 'tags', 'projects', 'project_milestones', 'goals',
    'goal_milestones', 'tasks', 'task_tags', 'subtasks', 'notes', 'ideas',
    'remember_items', 'schedule_blocks', 'reminders', 'focus_sessions', 'user_settings',
  ];
  realtimeChannel = sb.channel('lifeos-sync');
  for (const t of tables) {
    realtimeChannel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: t },
      (payload: any) => {
        try {
          if (payload.eventType === 'DELETE' || payload.event === 'DELETE') {
            removeLocal(t, payload.old?.id ?? null);
          } else {
            const row = payload.new;
            if (row) mergeRemoteRow(t, row);
          }
          void persistTable(t);
          emit();
        } catch { /* ignore malformed events */ }
      }
    );
  }
  realtimeChannel.subscribe((status: string) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      // Supabase-js retries automatically; nothing to do.
    }
  });
}

// ------------------------------------------------------------------
// Merge / persistence
// ------------------------------------------------------------------
function hasPendingOp(table: string, id: string): boolean {
  return outbox.some((o) => !o.dead && o.table === table &&
    ((o.kind !== 'delete' && o.kind === 'insert' && o.row?.id === id) ||
      (o.ref === id)));
}

function mergeRemoteRow(table: Table, remote: Row) {
  if (table === 'user_settings') {
    if (!uid || (remote as any).user_id !== uid) return;
    const local = state.user_settings as unknown as Row | null;
    if (!local || ((remote.updated_at ?? '') >= (local.updated_at ?? ''))) {
      state.user_settings = remote as any;
    }
    return;
  }
  const list = (state as any)[table] as Row[] | undefined;
  if (!list) return;
  const idx = list.findIndex((r) => r.id === remote.id);
  if (idx === -1) {
    list.push(remote);
  } else {
    const local = list[idx];
    if (hasPendingOp(table, remote.id)) return; // local wins until flushed
    if ((remote.updated_at ?? '') >= (local.updated_at ?? '')) list[idx] = remote;
  }
}

function removeLocal(table: Table, id: string | null) {
  if (!id) return;
  const list = (state as any)[table] as Row[] | undefined;
  if (!list) return;
  const idx = list.findIndex((r) => r.id === id);
  if (idx >= 0 && !hasPendingOp(table, id)) list.splice(idx, 1);
}

async function persistTable(table: Table) {
  if (!uid) return;
  if (table === 'user_settings') {
    await idbSet(cacheKey(uid, 'user_settings'), state.user_settings);
    return;
  }
  const list = (state as any)[table];
  if (Array.isArray(list)) await idbSet(cacheKey(uid, table), list);
}

async function persistAll() {
  const tables: Table[] = [
    'profiles', 'categories', 'tags', 'projects', 'project_milestones', 'goals',
    'goal_milestones', 'tasks', 'subtasks', 'task_tags', 'notes', 'ideas',
    'remember_items', 'schedule_blocks', 'reminders', 'focus_sessions',
  ];
  for (const t of tables) await persistTable(t);
  await persistTable('user_settings');
  await idbSet('outbox', outbox);
}

// ------------------------------------------------------------------
// Pull (full refresh)
// ------------------------------------------------------------------
export async function pull(): Promise<void> {
  const sb = getClient();
  if (DEMO || !sb || !uid || pulling) return;
  pulling = true;
  let hadError = false;
  try {
    const rowTables: Table[] = [
      'categories', 'tags', 'projects', 'project_milestones', 'goals',
      'goal_milestones', 'tasks', 'subtasks', 'task_tags', 'notes', 'ideas',
      'remember_items', 'schedule_blocks', 'reminders', 'focus_sessions',
    ];
    for (const t of rowTables) {
      const { data, error } = await sb.from(t).select('*').eq('user_id', uid);
      if (error) { hadError = true; continue; }
      const remote: Row[] = data ?? [];
      const localList = ((state as any)[t] ?? []) as Row[];
      const pendingIds = new Set(
        remote.length >= 0 ? localList.filter((l) => hasPendingOp(t, l.id)).map((l) => l.id) : []
      );
      const remoteIds = new Set(remote.map((r) => r.id));
      const merged: Row[] = [];
      for (const r of remote) {
        const l = localList.find((x) => x.id === r.id);
        if (!l) { merged.push(r); continue; }
        if (pendingIds.has(r.id)) { merged.push(l); continue; }
        merged.push((r.updated_at ?? '') >= (l.updated_at ?? '') ? r : l);
      }
      // keep pending inserts that are not yet on the server
      for (const l of localList) {
        if (!remoteIds.has(l.id) && pendingIds.has(l.id)) merged.push(l);
      }
      (state as any)[t] = merged;
    }
    const { data: prof } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (prof) state.profiles = [prof];
    const { data: settings } = await sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle();
    if (settings) state.user_settings = settings;
    await persistAll();
  } catch (e: any) {
    hadError = true;
    toast(pullErrorMessage(e), 'error');
  } finally {
    pulling = false;
    emit();
  }
  if (hadError && online) {
    toast('Sync problem — your data is safe locally. Will retry.', 'error');
  }
}

function pullErrorMessage(e: any): string {
  const msg = String(e?.message ?? e ?? '');
  if (/fetch|network|Failed to fetch/i.test(msg)) return 'No connection to the server. Working offline.';
  if (/JWT|401|token/i.test(msg)) return 'Your session expired. Please sign in again.';
  return 'Could not refresh data: ' + msg;
}

// ------------------------------------------------------------------
// Flush (push outbox to server)
// ------------------------------------------------------------------
export async function flush(): Promise<void> {
  const sb = getClient();
  if (DEMO || !sb || !uid || flushing || !online) return;
  flushing = true;
  try {
    const ops = await loadOutbox();
    outbox = ops;
    const done = new Set<string>();
    for (const op of ops) {
      if (op.dead || done.has(op.id)) continue;
      try {
        await applyOp(sb, op);
        done.add(op.id);
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '');
        if (/fetch|network|Failed to fetch/i.test(msg)) break; // offline mid-flush
        if (/duplicate key|violates|unique/i.test(msg) && op.kind === 'insert') {
          done.add(op.id); // already exists server-side; treat as done
          continue;
        }
        await bumpAttempt(op.id, msg);
        const cur = outbox.find((o) => o.id === op.id);
        if (cur && cur.attempts >= 12) {
          cur.dead = true;
          toast('A change could not be synced and was parked. Check Settings → Sync.', 'error');
          if (op.kind !== 'delete' && op.kind !== 'insert' && op.table !== 'user_settings' && op.ref && op.patch) {
            // keep local state but warn — never silently overwrite
          }
        }
        continue;
      }
    }
    if (done.size) {
      outbox = await markFlushed(done);
      await idbSet('outbox', outbox);
      emit();
      void pull();
    }
  } finally {
    flushing = false;
  }
}

async function applyOp(sb: any, op: OutboxOp): Promise<void> {
  const t = op.table;
  if (t === 'user_settings') {
    const ref = op.ref ?? uid;
    if (op.kind === 'delete') { await sb.from(t).delete().eq('user_id', ref); return; }
    const payload = op.kind === 'insert' ? op.row : { user_id: ref, data: op.patch?.data ?? {} };
    if (op.kind === 'update' && op.patch?.data) payload.data = op.patch.data;
    const { error } = await sb.from(t).upsert({ user_id: ref, data: payload.data ?? {}, updated_at: new Date().toISOString() });
    if (error) throw error;
    return;
  }
  if (t === 'task_tags' && op.kind === 'delete' && op.ref && op.ref.includes(':')) {
    const [taskId, tagId] = op.ref.split(':');
    const { error } = await sb.from(t).delete().eq('task_id', taskId).eq('tag_id', tagId);
    if (error) throw error;
    return;
  }
  if (op.kind === 'insert') {
    const row = { ...op.row, user_id: uid };
    const { error } = await sb.from(t).upsert(row);
    if (error) throw error;
    return;
  }
  if (op.kind === 'update') {
    const patch = { ...op.patch, user_id: uid };
    const { error } = await sb.from(t).update(patch).eq('id', op.ref!);
    if (error) throw error;
    return;
  }
  if (op.kind === 'delete') {
    const { error } = await sb.from(t).delete().eq('id', op.ref!);
    if (error) throw error;
  }
}

async function enqueue(op: Omit<OutboxOp, 'id' | 'seq' | 'attempts' | 'ts'>) {
  outboxSeq += 1;
  outbox = await pushOp(op, outboxSeq);
  await idbSet('outbox', outbox);
  emit();
  // fire-and-forget flush
  setTimeout(() => { void flush(); }, 400);
}

// ------------------------------------------------------------------
// Generic CRUD
// ------------------------------------------------------------------
async function insertRow<T extends Row>(table: Table, row: T): Promise<T> {
  (state as any)[table].push(row);
  await persistTable(table);
  await enqueue({ kind: 'insert', table, row, ref: row.id });
  emit();
  return row;
}

async function updateRow(table: Table, id: string, patch: Record<string, any>): Promise<void> {
  const list = (state as any)[table] as Row[];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const updated = { ...list[idx], ...patch, updated_at: new Date().toISOString() };
  list[idx] = updated;
  await persistTable(table);
  await enqueue({ kind: 'update', table, ref: id, patch: { ...patch, updated_at: updated.updated_at } });
  emit();
}

async function deleteRow(table: Table, id: string, cascadeTables: Table[] = []): Promise<void> {
  const list = (state as any)[table] as Row[];
  const idx = list.findIndex((r) => r.id === id);
  if (idx >= 0) list.splice(idx, 1);
  for (const c of cascadeTables) {
    const cl = (state as any)[c] as Row[];
    const key = c === 'task_tags' ? null : null;
    if (key === null) {
      (state as any)[c] = cl.filter((r) => {
        if (c === 'subtasks' || c === 'project_milestones' || c === 'goal_milestones') {
          const fk = c === 'subtasks' ? 'task_id' : c === 'project_milestones' ? 'project_id' : 'goal_id';
          return r[fk] !== id;
        }
        return r.task_id !== id && r.id !== id;
      });
    }
  }
  await persistTable(table);
  for (const c of cascadeTables) await persistTable(c);
  await enqueue({ kind: 'delete', table, ref: id });
  emit();
}

// ------------------------------------------------------------------
// Default seeds (categories)
// ------------------------------------------------------------------
const DEFAULT_CATEGORIES = [
  'College', 'Study', 'Work', 'Personal', 'Fitness', 'Projects', 'Finance', 'Important', 'Other',
];
const CATEGORY_COLORS: Record<string, string> = {
  College: '#6366f1', Study: '#8b5cf6', Work: '#0ea5e9', Personal: '#10b981',
  Fitness: '#f59e0b', Projects: '#ef4444', Finance: '#14b8a6', Important: '#f43f5e', Other: '#64748b',
};

async function seedDefaults() {
  if (!uid) return;
  if (DEMO && state.profiles.length === 0) {
    state.profiles = [{
      id: uid, username: 'Demo', email: 'demo@lifeos.local', avatar_url: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }];
    await persistTable('profiles');
    await seedDemoData();
  }
  if (state.categories.length === 0 && !outbox.some((o) => o.table === 'categories')) {
    let i = 0;
    for (const name of DEFAULT_CATEGORIES) {
      outboxSeq += 1;
      await insertRow<Category>('categories', {
        id: crypto.randomUUID(),
        user_id: uid,
        name,
        color: CATEGORY_COLORS[name] ?? '#6366f1',
        icon: null,
        sort_order: i++,
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Category);
    }
  }
}

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------
export function getSettings(): Record<string, any> {
  return state.user_settings?.data ?? {};
}

export async function updateSettings(patch: Record<string, any>): Promise<void> {
  if (!uid) return;
  const data = { ...getSettings(), ...patch };
  const row = { user_id: uid, data, updated_at: new Date().toISOString() };
  const isNew = !state.user_settings;
  state.user_settings = row as any;
  await persistTable('user_settings');
  await enqueue({
    kind: isNew ? 'insert' : 'update',
    table: 'user_settings',
    ref: uid,
    row,
    patch: { data },
  });
  emit();
}

// ------------------------------------------------------------------
// Tasks
// ------------------------------------------------------------------
export interface CreateTaskInput extends Partial<Task> { subtaskTitles?: string[]; }

export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (!uid) throw new Error('Not signed in');
  const minSort = state.tasks.reduce((m, t) => Math.min(m, t.sort_order), 0);
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    user_id: uid,
    title: input.title?.trim() || 'Untitled task',
    notes: input.notes ?? null,
    status: input.status ?? (input.due_date ? 'planned' : 'inbox'),
    priority: input.priority ?? 'medium',
    due_date: input.due_date ?? null,
    due_time: input.due_time ?? null,
    start_time: input.start_time ?? null,
    category_id: input.category_id ?? null,
    project_id: input.project_id ?? null,
    goal_id: input.goal_id ?? null,
    recurrence: input.recurrence ?? null,
    recurrence_days: input.recurrence_days ?? null,
    recurrence_monthday: input.recurrence_monthday ?? null,
    recurrence_anchor: input.recurrence_anchor ?? input.due_date ?? null,
    completed_occurrences: {},
    occurrence_overrides: {},
    reminder_minutes: input.reminder_minutes ?? null,
    estimated_minutes: input.estimated_minutes ?? null,
    actual_minutes: null,
    sort_order: minSort - 1,
    completed_at: null,
    completed_at_date: null,
    archived: false,
    deleted: false,
    created_at: now,
    updated_at: now,
    tag_ids: input.tag_ids ?? [],
  };
  await insertRow('tasks', task as any);
  for (const tagId of task.tag_ids ?? []) {
    await linkTaskTag(task.id, tagId);
  }
  if (input.subtaskTitles?.length) {
    let i = 0;
    for (const title of input.subtaskTitles) {
      await createSubtask(task.id, title, i++);
    }
  }
  return task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await updateRow('tasks', id, patch as Record<string, any>);
}

export interface DeletedTaskSnapshot {
  task: Task; subtasks: Subtask[]; tagIds: string[];
}

const deleteSnapshots = new Map<string, DeletedTaskSnapshot>();

export async function deleteTask(id: string): Promise<DeletedTaskSnapshot | null> {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  const subtasks = state.subtasks.filter((s) => s.task_id === id);
  const tagIds = state.task_tags.filter((tt) => tt.task_id === id).map((tt) => tt.tag_id);
  deleteSnapshots.set(id, { task, subtasks, tagIds });
  for (const s of subtasks) await enqueue({ kind: 'delete', table: 'subtasks', ref: s.id });
  for (const tt of state.task_tags.filter((tt) => tt.task_id === id)) {
    await enqueue({ kind: 'delete', table: 'task_tags', ref: `${tt.task_id}:${tt.tag_id}` });
  }
  state.subtasks = state.subtasks.filter((s) => s.task_id !== id);
  state.task_tags = state.task_tags.filter((tt) => tt.task_id !== id);
  await persistTable('subtasks');
  await persistTable('task_tags');
  await deleteRow('tasks', id);
  return deleteSnapshots.get(id) ?? null;
}

export async function restoreTask(id: string): Promise<Task | null> {
  const snap = deleteSnapshots.get(id);
  if (!snap) return null;
  deleteSnapshots.delete(id);
  const task: Task = { ...snap.task, updated_at: new Date().toISOString() };
  await insertRow('tasks', task as any);
  for (const s of snap.subtasks) await insertRow('subtasks', { ...s, updated_at: task.updated_at } as any);
  for (const tagId of snap.tagIds) await linkTaskTag(task.id, tagId);
  return task;
}

export async function completeTask(id: string): Promise<void> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const now = new Date();
  if (t.recurrence) {
    const occ = t.due_date ?? todayStr();
    const occs = { ...(t.completed_occurrences ?? {}), [occ]: true };
    const nextAnchor = occ;
    await updateRow('tasks', id, {
      completed_occurrences: occs,
      recurrence_anchor: nextAnchor,
      status: 'planned',
    } as any);
  } else {
    await updateRow('tasks', id, {
      status: 'completed' as TaskStatus,
      completed_at: now.toISOString(),
      completed_at_date: todayStr(),
    } as any);
  }
}

export async function uncompleteTask(id: string): Promise<void> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.recurrence) {
    const occs = { ...(t.completed_occurrences ?? {}) };
    const lastOcc = Object.keys(occs).sort().pop();
    if (lastOcc) delete occs[lastOcc];
    await updateRow('tasks', id, { completed_occurrences: occs } as any);
  } else {
    await updateRow('tasks', id, {
      status: t.due_date ? 'planned' : 'inbox',
      completed_at: null,
      completed_at_date: null,
    } as any);
  }
}

export async function completeOccurrence(id: string, occ: string): Promise<void> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const occs = { ...(t.completed_occurrences ?? {}), [occ]: true };
  await updateRow('tasks', id, { completed_occurrences: occs } as any);
}

export async function uncompleteOccurrence(id: string, occ: string): Promise<void> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const occs = { ...(t.completed_occurrences ?? {}) };
  delete occs[occ];
  await updateRow('tasks', id, { completed_occurrences: occs } as any);
}

export async function duplicateTask(id: string): Promise<Task | null> {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  return createTask({
    title: t.title, notes: t.notes, status: t.status, priority: t.priority,
    due_date: t.due_date, due_time: t.due_time, start_time: t.start_time,
    category_id: t.category_id, project_id: t.project_id, goal_id: t.goal_id,
    reminder_minutes: t.reminder_minutes, estimated_minutes: t.estimated_minutes,
    tag_ids: state.task_tags.filter((tt) => tt.task_id === id).map((tt) => tt.tag_id),
    subtaskTitles: state.subtasks.filter((s) => s.task_id === id).map((s) => s.title),
  });
}

export async function reorderTasks(orderedIds: string[]): Promise<void> {
  let i = 0;
  for (const id of orderedIds) {
    const t = state.tasks.find((x) => x.id === id);
    if (t && t.sort_order !== i) {
      await updateRow('tasks', id, { sort_order: i } as any);
    }
    i++;
  }
  emit();
}

// ------------------------------------------------------------------
// Subtasks
// ------------------------------------------------------------------
export async function createSubtask(taskId: string, title: string, sortOrder?: number): Promise<Subtask> {
  if (!uid) throw new Error('Not signed in');
  const existing = state.subtasks.filter((s) => s.task_id === taskId);
  const sub: Subtask = {
    id: crypto.randomUUID(),
    user_id: uid,
    task_id: taskId,
    title: title.trim(),
    done: false,
    sort_order: sortOrder ?? existing.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insertRow('subtasks', sub as any);
  return sub;
}

export async function updateSubtask(id: string, patch: Partial<Subtask>): Promise<void> {
  await updateRow('subtasks', id, patch as Record<string, any>);
}

export async function deleteSubtask(id: string): Promise<void> {
  await deleteRow('subtasks', id);
}

// ------------------------------------------------------------------
// Tags
// ------------------------------------------------------------------
export async function createTag(name: string, color?: string): Promise<Tag> {
  if (!uid) throw new Error('Not signed in');
  const clean = name.trim().replace(/^#/, '').toLowerCase();
  const existing = state.tags.find((t) => t.name === clean);
  if (existing) return existing;
  const tag: Tag = {
    id: crypto.randomUUID(), user_id: uid, name: clean,
    color: color ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await insertRow('tags', tag as any);
  return tag;
}

export async function updateTag(id: string, patch: Partial<Tag>): Promise<void> {
  await updateRow('tags', id, patch as Record<string, any>);
}

export async function deleteTag(id: string): Promise<void> {
  const links = state.task_tags.filter((tt) => tt.tag_id === id);
  for (const l of links) await enqueue({ kind: 'delete', table: 'task_tags', ref: `${l.task_id}:${l.tag_id}` });
  state.task_tags = state.task_tags.filter((tt) => tt.tag_id !== id);
  await persistTable('task_tags');
  await deleteRow('tags', id);
}

export async function linkTaskTag(taskId: string, tagId: string): Promise<void> {
  if (!uid) return;
  if (state.task_tags.some((tt) => tt.task_id === taskId && tt.tag_id === tagId)) return;
  const link = { task_id: taskId, tag_id: tagId, user_id: uid };
  state.task_tags.push(link as any);
  await persistTable('task_tags');
  await enqueue({ kind: 'insert', table: 'task_tags', row: { ...link, id: crypto.randomUUID() }, ref: taskId + ':' + tagId });
  emit();
}

export async function unlinkTaskTag(taskId: string, tagId: string): Promise<void> {
  state.task_tags = state.task_tags.filter((tt) => !(tt.task_id === taskId && tt.tag_id === tagId));
  await persistTable('task_tags');
  await enqueue({ kind: 'delete', table: 'task_tags', ref: `${taskId}:${tagId}` });
  emit();
}

// ------------------------------------------------------------------
// Categories
// ------------------------------------------------------------------
export async function createCategory(name: string, color?: string): Promise<Category> {
  if (!uid) throw new Error('Not signed in');
  const cat: Category = {
    id: crypto.randomUUID(), user_id: uid, name: name.trim(),
    color: color ?? '#6366f1', icon: null,
    sort_order: state.categories.length,
    is_default: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await insertRow('categories', cat as any);
  return cat;
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  await updateRow('categories', id, patch as Record<string, any>);
}

export async function deleteCategory(id: string): Promise<void> {
  await deleteRow('categories', id);
}

// ------------------------------------------------------------------
// Projects & milestones
// ------------------------------------------------------------------
export async function createProject(input: Partial<Project>): Promise<Project> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const p: Project = {
    id: crypto.randomUUID(), user_id: uid,
    name: input.name?.trim() || 'Untitled project',
    description: input.description ?? null,
    status: input.status ?? 'planning',
    priority: input.priority ?? 'medium',
    color: input.color ?? '#6366f1',
    start_date: input.start_date ?? null,
    target_date: input.target_date ?? null,
    completed_at: null,
    archived: false,
    sort_order: state.projects.length,
    created_at: now, updated_at: now,
  };
  await insertRow('projects', p as any);
  for (const m of input.milestones ?? []) {
    await createProjectMilestone(p.id, m.title ?? 'Milestone', m.due_date ?? null);
  }
  return p;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await updateRow('projects', id, patch as Record<string, any>);
}

export async function deleteProject(id: string): Promise<void> {
  const ms = state.project_milestones.filter((m) => m.project_id === id);
  for (const m of ms) await enqueue({ kind: 'delete', table: 'project_milestones', ref: m.id });
  state.project_milestones = state.project_milestones.filter((m) => m.project_id !== id);
  await persistTable('project_milestones');
  // detach tasks
  for (const t of state.tasks.filter((x) => x.project_id === id)) {
    await updateRow('tasks', t.id, { project_id: null } as any);
  }
  await deleteRow('projects', id);
}

export async function createProjectMilestone(projectId: string, title: string, dueDate?: string | null): Promise<ProjectMilestone> {
  if (!uid) throw new Error('Not signed in');
  const m: ProjectMilestone = {
    id: crypto.randomUUID(), user_id: uid, project_id: projectId,
    title: title.trim(), due_date: dueDate ?? null, done: false,
    sort_order: state.project_milestones.filter((x) => x.project_id === projectId).length,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await insertRow('project_milestones', m as any);
  return m;
}

export async function updateProjectMilestone(id: string, patch: Partial<ProjectMilestone>): Promise<void> {
  await updateRow('project_milestones', id, patch as Record<string, any>);
}

export async function deleteProjectMilestone(id: string): Promise<void> {
  await deleteRow('project_milestones', id);
}

// ------------------------------------------------------------------
// Goals & milestones
// ------------------------------------------------------------------
export async function createGoal(input: Partial<Goal>): Promise<Goal> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const g: Goal = {
    id: crypto.randomUUID(), user_id: uid,
    title: input.title?.trim() || 'Untitled goal',
    description: input.description ?? null,
    horizon: input.horizon ?? 'long_term',
    deadline: input.deadline ?? null,
    progress: input.progress ?? 0,
    status: 'active',
    color: input.color ?? '#6366f1',
    sort_order: state.goals.length,
    completed_at: null,
    created_at: now, updated_at: now,
  };
  await insertRow('goals', g as any);
  for (const m of input.milestones ?? []) {
    await createGoalMilestone(g.id, m.title ?? 'Milestone');
  }
  return g;
}

export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
  await updateRow('goals', id, patch as Record<string, any>);
}

export async function deleteGoal(id: string): Promise<void> {
  const ms = state.goal_milestones.filter((m) => m.goal_id === id);
  for (const m of ms) await enqueue({ kind: 'delete', table: 'goal_milestones', ref: m.id });
  state.goal_milestones = state.goal_milestones.filter((m) => m.goal_id !== id);
  await persistTable('goal_milestones');
  for (const t of state.tasks.filter((x) => x.goal_id === id)) {
    await updateRow('tasks', t.id, { goal_id: null } as any);
  }
  await deleteRow('goals', id);
}

export async function createGoalMilestone(goalId: string, title: string): Promise<GoalMilestone> {
  if (!uid) throw new Error('Not signed in');
  const m: GoalMilestone = {
    id: crypto.randomUUID(), user_id: uid, goal_id: goalId,
    title: title.trim(), done: false,
    sort_order: state.goal_milestones.filter((x) => x.goal_id === goalId).length,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await insertRow('goal_milestones', m as any);
  return m;
}

export async function updateGoalMilestone(id: string, patch: Partial<GoalMilestone>): Promise<void> {
  await updateRow('goal_milestones', id, patch as Record<string, any>);
}

export async function deleteGoalMilestone(id: string): Promise<void> {
  await deleteRow('goal_milestones', id);
}

// ------------------------------------------------------------------
// Notes
// ------------------------------------------------------------------
export async function createNote(input: Partial<Note>): Promise<Note> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const n: Note = {
    id: crypto.randomUUID(), user_id: uid,
    title: input.title ?? '',
    content: input.content ?? '',
    folder: input.folder ?? null,
    pinned: input.pinned ?? false,
    favorite: input.favorite ?? false,
    archived: false,
    deleted: false,
    tags: input.tags ?? [],
    linked_task_id: input.linked_task_id ?? null,
    linked_project_id: input.linked_project_id ?? null,
    linked_goal_id: input.linked_goal_id ?? null,
    sort_order: 0,
    created_at: now, updated_at: now,
  };
  await insertRow('notes', n as any);
  return n;
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<void> {
  await updateRow('notes', id, patch as Record<string, any>);
}

export async function deleteNote(id: string): Promise<void> {
  await deleteRow('notes', id);
}

// ------------------------------------------------------------------
// Ideas
// ------------------------------------------------------------------
export async function createIdea(input: Partial<Idea>): Promise<Idea> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const i: Idea = {
    id: crypto.randomUUID(), user_id: uid,
    title: input.title?.trim() || 'Untitled idea',
    description: input.description ?? null,
    why: input.why ?? null,
    notes: input.notes ?? null,
    links: input.links ?? null,
    status: input.status ?? 'idea',
    priority: input.priority ?? 'medium',
    effort: input.effort ?? null,
    possible_start: input.possible_start ?? null,
    target_date: input.target_date ?? null,
    converted_project_id: null,
    archived: false,
    deleted: false,
    sort_order: state.ideas.length,
    created_at: now, updated_at: now,
  };
  await insertRow('ideas', i as any);
  return i;
}

export async function updateIdea(id: string, patch: Partial<Idea>): Promise<void> {
  await updateRow('ideas', id, patch as Record<string, any>);
}

export async function deleteIdea(id: string): Promise<void> {
  await deleteRow('ideas', id);
}

/** One-button convert: idea → active project */
export async function convertIdeaToProject(ideaId: string): Promise<Project | null> {
  const idea = state.ideas.find((i) => i.id === ideaId);
  if (!idea) return null;
  const p = await createProject({
    name: idea.title,
    description: [idea.description, idea.why ? `Why: ${idea.why}` : null, idea.links ? `Links: ${idea.links}` : null]
      .filter(Boolean).join('\n\n') || null,
    status: 'active',
    priority: idea.priority,
    start_date: idea.possible_start ?? todayStr(),
    target_date: idea.target_date ?? null,
  });
  await updateRow('ideas', ideaId, { status: 'active', converted_project_id: p.id } as any);
  return p;
}

// ------------------------------------------------------------------
// Remember items
// ------------------------------------------------------------------
export async function createRememberItem(input: Partial<RememberItem>): Promise<RememberItem> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const r: RememberItem = {
    id: crypto.randomUUID(), user_id: uid,
    title: input.title?.trim() || 'Untitled',
    content: input.content ?? '',
    category: input.category ?? null,
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    favorite: input.favorite ?? false,
    deleted: false,
    sort_order: state.remember_items.length,
    created_at: now, updated_at: now,
  };
  await insertRow('remember_items', r as any);
  return r;
}

export async function updateRememberItem(id: string, patch: Partial<RememberItem>): Promise<void> {
  await updateRow('remember_items', id, patch as Record<string, any>);
}

export async function deleteRememberItem(id: string): Promise<void> {
  await deleteRow('remember_items', id);
}

// ------------------------------------------------------------------
// Schedule blocks
// ------------------------------------------------------------------
export async function createScheduleBlock(input: Partial<ScheduleBlock>): Promise<ScheduleBlock> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const b: ScheduleBlock = {
    id: crypto.randomUUID(), user_id: uid,
    title: input.title?.trim() || 'Block',
    weekday: input.weekday ?? 1,
    start_time: input.start_time ?? '09:00:00',
    end_time: input.end_time ?? '10:00:00',
    category_id: input.category_id ?? null,
    color: input.color ?? '#6366f1',
    icon: input.icon ?? null,
    notes: input.notes ?? null,
    recurrence: input.recurrence ?? 'weekly',
    linked_task_id: input.linked_task_id ?? null,
    deleted: false,
    sort_order: 0,
    created_at: now, updated_at: now,
  };
  await insertRow('schedule_blocks', b as any);
  return b;
}

export async function updateScheduleBlock(id: string, patch: Partial<ScheduleBlock>): Promise<void> {
  await updateRow('schedule_blocks', id, patch as Record<string, any>);
}

export async function deleteScheduleBlock(id: string): Promise<void> {
  await deleteRow('schedule_blocks', id);
}

// ------------------------------------------------------------------
// Reminders
// ------------------------------------------------------------------
export async function createReminder(input: Partial<Reminder>): Promise<Reminder> {
  if (!uid) throw new Error('Not signed in');
  const now = new Date().toISOString();
  const r: Reminder = {
    id: crypto.randomUUID(), user_id: uid,
    title: input.title?.trim() || 'Reminder',
    notes: input.notes ?? null,
    due_at: input.due_at ?? new Date().toISOString(),
    priority: input.priority ?? 'medium',
    important: input.important ?? false,
    done: false,
    snoozed_until: null,
    recurrence: input.recurrence ?? null,
    task_id: input.task_id ?? null,
    project_id: input.project_id ?? null,
    goal_id: input.goal_id ?? null,
    deleted: false,
    fired_at: null,
    created_at: now, updated_at: now,
  };
  await insertRow('reminders', r as any);
  return r;
}

export async function updateReminder(id: string, patch: Partial<Reminder>): Promise<void> {
  await updateRow('reminders', id, patch as Record<string, any>);
}

export async function deleteReminder(id: string): Promise<void> {
  await deleteRow('reminders', id);
}

export async function snoozeReminder(id: string, minutes: number): Promise<void> {
  const until = new Date(Date.now() + minutes * 60000).toISOString();
  await updateRow('reminders', id, { snoozed_until: until, fired_at: null } as any);
}

// ------------------------------------------------------------------
// Focus sessions
// ------------------------------------------------------------------
export async function createFocusSession(input: Partial<FocusSession>): Promise<void> {
  if (!uid) return;
  const fs: FocusSession = {
    id: crypto.randomUUID(), user_id: uid,
    task_id: input.task_id ?? null,
    mode: input.mode ?? 'pomodoro',
    duration_minutes: input.duration_minutes ?? 25,
    completed_minutes: input.completed_minutes ?? 0,
    completed: input.completed ?? false,
    started_at: input.started_at ?? new Date().toISOString(),
    ended_at: input.ended_at ?? new Date().toISOString(),
  };
  await insertRow('focus_sessions', fs as any);
}

// ------------------------------------------------------------------
// Profile
// ------------------------------------------------------------------
export function getProfile(): Profile | null {
  return state.profiles[0] ?? null;
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  if (!uid) return;
  const p = state.profiles[0];
  if (!p) {
    await insertRow('profiles', {
      id: uid, username: patch.username ?? null, email: patch.email ?? null,
      avatar_url: patch.avatar_url ?? null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as any);
    return;
  }
  await updateRow('profiles', uid, patch as Record<string, any>);
}

// ------------------------------------------------------------------
// Selectors (read from memory)
// ------------------------------------------------------------------
export function dbState(): DBState { return state; }

export function getTaskById(id: string): Task | undefined { return state.tasks.find((t) => t.id === id); }
export function subtasksOf(taskId: string): Subtask[] {
  return state.subtasks.filter((s) => s.task_id === taskId).sort((a, b) => a.sort_order - b.sort_order);
}
export function tagsOf(taskId: string): Tag[] {
  const ids = new Set(state.task_tags.filter((tt) => tt.task_id === taskId).map((tt) => tt.tag_id));
  return state.tags.filter((t) => ids.has(t.id));
}
export function milestonesOfProject(projectId: string): ProjectMilestone[] {
  return state.project_milestones.filter((m) => m.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order);
}
export function milestonesOfGoal(goalId: string): GoalMilestone[] {
  return state.goal_milestones.filter((m) => m.goal_id === goalId).sort((a, b) => a.sort_order - b.sort_order);
}
export function tasksOfProject(projectId: string): Task[] {
  return state.tasks.filter((t) => t.project_id === projectId && !t.deleted && !t.archived);
}
export function tasksOfGoal(goalId: string): Task[] {
  return state.tasks.filter((t) => t.goal_id === goalId && !t.deleted && !t.archived);
}

export function projectProgress(projectId: string): number {
  const tasks = tasksOfProject(projectId);
  if (tasks.length === 0) {
    const ms = milestonesOfProject(projectId);
    if (ms.length === 0) return 0;
    return Math.round((ms.filter((m) => m.done).length / ms.length) * 100);
  }
  let total = 0, done = 0;
  for (const t of tasks) {
    const subs = subtasksOf(t.id);
    if (subs.length > 0) {
      total += subs.length;
      done += subs.filter((s) => s.done).length;
    } else {
      total += 1;
      if (t.status === 'completed') done += 1;
    }
  }
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function goalProgress(goalId: string): number {
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) return 0;
  const ms = milestonesOfGoal(goalId);
  const tasks = tasksOfGoal(goalId);
  if (ms.length === 0 && tasks.length === 0) return g.progress;
  let total = 0, done = 0;
  for (const m of ms) { total += 1; if (m.done) done += 1; }
  for (const t of tasks) { total += 1; if (t.status === 'completed') done += 1; }
  return total === 0 ? g.progress : Math.round((done / total) * 100);
}

export type { Table };

// ------------------------------------------------------------------
// Demo seed data (only in #demo mode — no server, purely local)
// ------------------------------------------------------------------
async function seedDemoData(): Promise<void> {
  const cats = state.categories;
  const catId = (name: string) => cats.find((c) => c.name === name)?.id ?? null;
  const t = todayStr();

  await createTask({ title: 'Finish Laplace assignment', due_date: t, due_time: '19:00:00', priority: 'high', category_id: catId('College'), estimated_minutes: 90, reminder_minutes: 30 });
  await createTask({ title: 'Gym session', due_date: t, due_time: '18:00:00', priority: 'medium', category_id: catId('Fitness'), recurrence: 'custom', recurrence_days: [1, 3, 5], recurrence_anchor: t });
  await createTask({ title: 'Pay electricity bill', due_date: addDaysStr(t, -1), priority: 'urgent', category_id: catId('Finance') });
  await createTask({ title: 'Read 20 pages', due_date: t, priority: 'low', category_id: catId('Personal') });
  await createTask({ title: 'Plan weekend trip', status: 'inbox', category_id: catId('Personal') });
  const doneTask = await createTask({ title: 'Morning review', due_date: t, priority: 'medium', category_id: catId('Personal') });
  await completeTask(doneTask.id);

  const proj = await createProject({
    name: 'Build AI Attendance System', description: 'Face-recognition based attendance for the department.',
    status: 'active', priority: 'high', color: '#8b5cf6', start_date: t, target_date: addDaysStr(t, 30),
  });
  await createProjectMilestone(proj.id, 'Improve face recognition');
  await createProjectMilestone(proj.id, 'Add database schema');
  const ui = await createProjectMilestone(proj.id, 'Create UI');
  await updateProjectMilestone(ui.id, { done: true });
  await createProjectMilestone(proj.id, 'Test system');
  await createProjectMilestone(proj.id, 'Prepare documentation');
  await createTask({ title: 'Improve face recognition accuracy', project_id: proj.id, due_date: addDaysStr(t, 2), priority: 'high', category_id: catId('Projects') });
  await createTask({ title: 'Write database migration', project_id: proj.id, due_date: addDaysStr(t, 4), priority: 'medium', category_id: catId('Projects') });

  const goal = await createGoal({ title: 'Improve programming skills', description: 'Level up beyond coursework.', horizon: 'yearly', deadline: `${t.slice(0, 4)}-12-31`, color: '#10b981' });
  await createGoalMilestone(goal.id, 'Learn C++');
  await createGoalMilestone(goal.id, 'Build 3 projects');
  await createGoalMilestone(goal.id, 'Learn Git');
  await createGoalMilestone(goal.id, 'Build portfolio');

  await createIdea({ title: 'Campus event app', description: 'Ticketing + schedule for college fests.', why: 'Every fest runs on Google Forms and chaos.', status: 'someday', priority: 'medium', effort: 'l' });
  await createIdea({ title: 'Personal finance tracker', description: 'Simple expense dashboard with monthly summaries.', why: 'Stop wondering where money goes.', status: 'ready_to_start', priority: 'high', effort: 'm' });

  await createRememberItem({ title: 'Deep work principles', content: '1. No phone in the room.\n2. One tab rule.\n3. 90-minute blocks, real breaks.\n4. Ship before polishing.', category: 'Principle', tags: ['focus'], pinned: true });
  await createRememberItem({ title: 'Important passwords & accounts', content: 'Recovery email, college portal, billing accounts — keep updated.', category: 'Info', tags: ['personal'] });

  await createNote({ title: 'Laplace formulas cheat-sheet', content: 'Key transforms and properties worth memorizing before the exam.', folder: 'College', tags: ['exam', 'math'], pinned: true });
  await createNote({ title: 'Project ideas backlog', content: '- AI attendance\n- Fest app\n- Finance tracker', folder: 'Ideas', tags: ['coding'] });

  await createScheduleBlock({ title: 'College', weekday: weekdayOf(t), start_time: '08:00:00', end_time: '14:00:00', color: '#0ea5e9', category_id: catId('College') });
  await createScheduleBlock({ title: 'Gym', weekday: weekdayOf(t), start_time: '16:00:00', end_time: '17:30:00', color: '#f59e0b', category_id: catId('Fitness') });
  await createScheduleBlock({ title: 'Project work', weekday: weekdayOf(t), start_time: '18:00:00', end_time: '20:00:00', color: '#8b5cf6', category_id: catId('Projects') });

  await createReminder({ title: 'Call home', due_at: new Date(Date.now() + 2 * 3600e3).toISOString(), important: true, priority: 'medium' });
  await createReminder({ title: 'Library book return', due_at: new Date(Date.now() + 26 * 3600e3).toISOString(), priority: 'low' });

  await createFocusSession({ task_id: doneTask.id, mode: 'pomodoro', duration_minutes: 25, completed_minutes: 25, completed: true, started_at: new Date(Date.now() - 3600e3).toISOString() });
}

function addDaysStr(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function weekdayOf(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
