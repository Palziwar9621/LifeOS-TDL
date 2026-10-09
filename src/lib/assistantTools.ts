import * as db from './db';
import { todayStr } from './dates';
import { matchOne } from './assistantSafety';
import { validateToolCall, UNSUPPORTED_CONTROLS, type ToolCall } from '../../supabase/functions/assistant/contract';

type Row = { id: string; title?: string; name?: string; deleted?: boolean; archived?: boolean; [key: string]: any };
const label = (r: Row) => r.title ?? r.name ?? '';
const live = (rows: Row[]) => rows.filter(r => !r.deleted && !r.archived && r.status !== 'archived');
function alarmRefresh() { void import('./nativeAlarms').then(m => m.syncNativeAlarms()).catch(() => {}); }
function describe(row: Row): string {
  const timing = row.due_date ?? row.target_date ?? row.deadline ?? row.extra_date;
  return `${label(row)}${timing ? ` on ${timing}` : ''}${row.due_time || row.time_of_day ? ` at ${(row.due_time ?? row.time_of_day).slice(0, 5)}` : ''}${row.due_at ? ` at ${new Date(row.due_at).toLocaleString()}` : ''}${row.snoozed_until ? `, snoozed until ${new Date(row.snoozed_until).toLocaleString()}` : ''}${row.start_time ? `, ${row.recurrence === 'daily' ? 'daily' : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][row.weekday]} ${row.start_time.slice(0,5)}–${row.end_time.slice(0,5)} (${row.recurrence})` : ''}${row.status ? ` (${row.status})` : row.done != null ? row.done ? ' (done)' : ' (open)' : ''}${row.progress != null ? `, ${row.progress}%` : ''}${row.days?.length ? `, ${row.days.map((d: number) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}` : ''}`;
}
function listReply(rows: Row[], noun: string): string {
  return rows.length ? `You have ${rows.length} ${noun}: ${rows.slice(0, 8).map(describe).join('; ')}.${rows.length > 8 ? ' Those are the first eight.' : ''}` : `No matching ${noun} found.`;
}

export async function runAssistantTool(input: ToolCall, ctx: { navigate: (page: any, params?: Record<string, string>) => void }): Promise<string> {
  const { name, args: a } = validateToolCall(input);
  const s = db.dbState();
  // These explicit adapters are the entire write surface. No model-chosen tables,
  // IDs, settings, database methods or arbitrary patches are accepted.
  const adapters: Record<string, { rows: Row[]; create: (p: any) => Promise<any>; update: (id: string, p: any) => Promise<void>; remove: (id: string) => Promise<any> }> = {
    task: { rows: live(s.tasks), create: db.createTask, update: db.updateTask, remove: db.deleteTask },
    note: { rows: live(s.notes), create: db.createNote, update: db.updateNote, remove: db.deleteNote },
    idea: { rows: live(s.ideas), create: db.createIdea, update: db.updateIdea, remove: db.deleteIdea },
    remember: { rows: live(s.remember_items), create: db.createRememberItem, update: db.updateRememberItem, remove: db.deleteRememberItem },
    reminder: { rows: live(s.reminders), create: db.createReminder, update: db.updateReminder, remove: db.deleteReminder },
    routine: { rows: live(s.routine_tasks), create: db.createRoutineTask, update: db.updateRoutineTask, remove: db.deleteRoutineTask },
    project: { rows: live(s.projects), create: db.createProject, update: db.updateProject, remove: db.deleteProject },
    goal: { rows: live(s.goals), create: db.createGoal, update: db.updateGoal, remove: db.deleteGoal },
  };
  const get = (kind: string, query: string) => matchOne(adapters[kind].rows, query, label);
  const category = (query: string) => matchOne(s.categories, query, c => c.name);
  const tagName = (value: string) => value.trim().replace(/^#/, '').trim().toLowerCase();
  const tag = (query: string) => matchOne(s.tags, tagName(query), t => tagName(t.name));
  if (['add_subtask', 'query_subtasks', 'update_subtask', 'delete_subtask'].includes(name)) {
    const task = get('task', a.task_match);
    const rows = s.subtasks.filter(sub => sub.task_id === task.id);
    if (name === 'query_subtasks') return listReply(rows, `subtasks in ${label(task)}`);
    if (name === 'add_subtask') {
      const sub = await db.createSubtask(task.id, a.title);
      return `Added “${sub.title}” under “${label(task)}”.`;
    }
    const sub = matchOne(rows, a.title_match, item => item.title);
    if (name === 'delete_subtask') { await db.deleteSubtask(sub.id); return `Deleted subtask “${sub.title}” from “${label(task)}”.`; }
    const patch: { title?: string; done?: boolean } = {};
    if ('new_title' in a) patch.title = a.new_title;
    if ('done' in a) patch.done = a.done;
    await db.updateSubtask(sub.id, patch);
    return `Updated subtask: ${describe({ ...sub, ...patch })}.`;
  }
  if (['create_tag','query_tags','update_tag','delete_tag','create_category','query_categories','update_category','delete_category'].includes(name)) {
    const isTag = name.endsWith('_tag') || name === 'query_tags';
    const noun = isTag ? 'tag' : 'category';
    const rows = isTag ? s.tags : s.categories;
    if (name.startsWith('query_')) {
      const matches = rows.filter(r => !a.name_contains || r.name.toLowerCase().includes(a.name_contains.toLowerCase()));
      return matches.length ? `${matches.length} ${isTag ? 'tags' : 'categories'}: ${matches.slice(0,8).map(r => r.name + (r.color ? ` (${r.color})` : '')).join('; ')}.${matches.length > 8 ? ' Those are the first eight.' : ''}` : `No matching ${isTag ? 'tags' : 'categories'} found.`;
    }
    if (name.startsWith('create_')) {
      const clean = isTag ? tagName(a.name) : a.name.trim();
      const existing = rows.filter(r => r.name.toLowerCase() === clean.toLowerCase());
      if (existing.length > 1) throw new Error(`There are duplicate ${noun} names. Rename them in the app first.`);
      if (existing.length) return `The ${noun} “${existing[0].name}” already exists. Its color was not changed.`;
      const row = isTag ? await db.createTag(clean, a.color) : await db.createCategory(clean, a.color);
      return `Created ${noun} “${row.name}”.`;
    }
    const row = isTag ? tag(a.name_match) : category(a.name_match);
    if (name.startsWith('delete_')) {
      if (!isTag) {
        if ((row as any).is_default) throw new Error('Default categories cannot be deleted by voice.');
        if (s.tasks.some(t => t.category_id === row.id) || s.schedule_blocks.some(b => b.category_id === row.id)) throw new Error('That category is still linked to tasks or planner blocks. Reassign those before deleting it.');
      }
      await (isTag ? db.deleteTag : db.deleteCategory)(row.id);
      return `Deleted ${noun} “${row.name}”.${isTag ? ' Its task links were removed; tasks were kept.' : ''}`;
    }
    const patch: { name?: string; color?: string } = {};
    if ('new_name' in a) {
      patch.name = isTag ? tagName(a.new_name) : a.new_name.trim();
      if (rows.some(r => r.id !== row.id && r.name.trim().toLowerCase() === patch.name!.toLowerCase())) throw new Error(`That ${noun} name already exists. I can’t merge them by voice.`);
    }
    if ('color' in a) patch.color = a.color;
    await (isTag ? db.updateTag : db.updateCategory)(row.id, patch);
    return `Updated ${noun} “${patch.name ?? row.name}”${patch.color ? ` to color ${patch.color}` : ''}.`;
  }
  if (name.includes('schedule_block')) {
    const rows = live(s.schedule_blocks);
    if (name === 'query_schedule_blocks') return listReply(rows.filter(r => (!a.title_contains || r.title!.toLowerCase().includes(a.title_contains.toLowerCase())) && (a.weekday == null || r.recurrence === 'daily' || r.weekday === a.weekday)), 'planner blocks');
    const row = name === 'add_schedule_block' ? null : matchOne(rows.filter(r => a.match_weekday == null || r.weekday === a.match_weekday), a.title_match, label);
    if (name === 'delete_schedule_block') { await db.deleteScheduleBlock(row!.id); alarmRefresh(); return `Deleted planner block “${label(row!)}”.`; }
    // All relationship targets are resolved before entering any write.
    const patch: Record<string, any> = {};
    for (const field of ['weekday', 'start_time', 'end_time', 'recurrence', 'color']) if (field in a) patch[field] = a[field];
    if ('category_match' in a) patch.category_id = a.category_match === null ? null : category(a.category_match).id;
    if ('linked_task_match' in a) patch.linked_task_id = a.linked_task_match === null ? null : get('task', a.linked_task_match).id;
    if ('title' in a) patch.title = a.title;
    if ('new_title' in a) patch.title = a.new_title;
    const start = (patch.start_time ?? row?.start_time)?.slice(0,5);
    const end = (patch.end_time ?? row?.end_time)?.slice(0,5);
    if (!start || !end || end <= start) throw new Error('The block must end after it starts on the same day.');
    if (row) await db.updateScheduleBlock(row.id, patch);
    const saved = row ? { ...row, ...patch } : await db.createScheduleBlock(patch);
    alarmRefresh();
    return `${row ? 'Updated' : 'Added'} planner block: ${describe(saved)}.`;
  }
  if (name === 'snooze_reminder' || name === 'complete_reminder') {
    const reminder = get('reminder', a.title_match);
    if (reminder.done) throw new Error('That reminder is already completed. Reopen it before snoozing or completing an occurrence.');
    if (name === 'snooze_reminder') await db.snoozeReminder(reminder.id, a.minutes);
    else await db.completeReminder(reminder.id);
    alarmRefresh();
    const saved = db.dbState().reminders.find(r => r.id === reminder.id)!;
    return name === 'snooze_reminder' ? `Snoozed “${reminder.title}” until ${new Date(saved.snoozed_until!).toLocaleString()}.` : saved.done ? `Completed reminder “${reminder.title}”.` : `Completed this occurrence of “${reminder.title}”. Next: ${new Date(saved.due_at).toLocaleString()}.`;
  }
  if (name === 'set_task_relationships' || name === 'set_task_tag' || name === 'query_task_relationships') {
    const task = get('task', a.title_match);
    if (name === 'query_task_relationships') {
      const tags = s.task_tags.filter(link => link.task_id === task.id).map(link => s.tags.find(t => t.id === link.tag_id)?.name).filter(Boolean);
      return `“${label(task)}”: project ${s.projects.find(p => p.id === task.project_id)?.name ?? 'none'}, goal ${s.goals.find(g => g.id === task.goal_id)?.title ?? 'none'}, category ${s.categories.find(c => c.id === task.category_id)?.name ?? 'none'}, tags ${tags.join(', ') || 'none'}.`;
    }
    if (name === 'set_task_tag') {
      const selected = tag(a.tag_match);
      await (a.attached ? db.linkTaskTag : db.unlinkTaskTag)(task.id, selected.id);
      return `${a.attached ? 'Attached' : 'Detached'} tag “${selected.name}” ${a.attached ? 'to' : 'from'} “${label(task)}”.`;
    }
    const patch: Record<string, string | null> = {};
    const changed: string[] = [];
    for (const kind of ['project', 'goal', 'category']) if (`${kind}_match` in a) {
      const target = a[`${kind}_match`] === null ? null : kind === 'category' ? category(a.category_match) : get(kind, a[`${kind}_match`]);
      patch[`${kind}_id`] = target?.id ?? null;
      changed.push(`${kind} ${target ? label(target) : 'unlinked'}`);
    }
    await db.updateTask(task.id, patch);
    return `Updated “${label(task)}”: ${changed.join(', ')}.`;
  }
  if (name.includes('milestone')) {
    const p = get(a.scope, a.name_match);
    const project = a.scope === 'project';
    const rows: Row[] = project ? s.project_milestones.filter(m => m.project_id === p.id) : s.goal_milestones.filter(m => m.goal_id === p.id);
    if (name === 'query_milestones') return listReply(rows, `milestones in ${label(p)}`);
    if (name === 'add_milestone') {
      const m = project ? await db.createProjectMilestone(p.id, a.title, a.due_date) : await db.createGoalMilestone(p.id, a.title);
      return `Added “${m.title}” to ${label(p)}.`;
    }
    const m = matchOne(rows, a.title_match, label);
    if (name === 'delete_milestone') {
      await (project ? db.deleteProjectMilestone : db.deleteGoalMilestone)(m.id);
      return `Deleted milestone “${label(m)}” from ${label(p)}.`;
    }
    const patch: Record<string, any> = {};
    if (name === 'complete_milestone') patch.done = true;
    if ('new_title' in a) patch.title = a.new_title;
    if ('due_date' in a) patch.due_date = a.due_date;
    if ('done' in a) patch.done = a.done;
    await (project ? db.updateProjectMilestone : db.updateGoalMilestone)(m.id, patch);
    return `Updated milestone: ${describe({ ...m, ...patch })}.`;
  }
  const queryKinds: Record<string, string> = { query_tasks: 'task', query_notes: 'note', query_ideas: 'idea', query_remember: 'remember', query_reminders: 'reminder', query_routines: 'routine', query_projects: 'project', query_goals: 'goal' };
  if (queryKinds[name]) {
    const kind = queryKinds[name];
    let rows = adapters[kind].rows;
    if (a.title_contains) rows = rows.filter(r => label(r).toLocaleLowerCase().includes(a.title_contains.toLocaleLowerCase()));
    if (kind === 'task') {
      const today = todayStr();
      const localDate = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
      if (a.date) rows = rows.filter(r => r.due_date === a.date);
      else if (a.date_range === 'today' || a.date_range === 'tomorrow') rows = rows.filter(r => r.due_date === localDate(a.date_range === 'today' ? 0 : 1));
      else if (a.date_range === 'this_week') rows = rows.filter(r => r.due_date >= today && r.due_date <= localDate(6));
      else if (a.date_range === 'overdue') rows = rows.filter(r => r.due_date && r.due_date < today && r.status !== 'completed');
      rows = [...rows].sort((x,y) => (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999'));
    }
    return listReply(rows, kind === 'remember' ? 'remember items' : `${kind}s`);
  }
  const op = name.match(/^(add|create|update|delete)_(task|note|idea|remember|reminder|routine|project|goal)$/);
  if (op) {
    const [, action, kind] = op;
    const adapter = adapters[kind];
    if (action === 'add' || action === 'create') {
      const patch = { ...a };
      if (kind === 'task') {
        delete patch.project_hint;
        patch.project_id = a.project_hint ? get('project', a.project_hint).id : null;
        patch.due_date = 'due_date' in a ? a.due_date : todayStr();
        patch.remind_me = a.remind_me ?? !!a.due_time;
        patch.reminder_minutes = patch.remind_me ? a.reminder_minutes ?? 0 : null;
      }
      const row = await adapter.create(patch);
      if (['task','reminder','routine'].includes(kind)) alarmRefresh();
      return `Added ${kind}: ${describe(row)}.`;
    }
    const row = get(kind, a.title_match ?? a.name_match);
    if (action === 'delete') {
      await adapter.remove(row.id);
      if (['task','reminder','routine'].includes(kind)) alarmRefresh();
      return `Deleted ${kind} “${label(row)}”.${['project','goal'].includes(kind) ? ' Its milestones were removed; its tasks were kept and unlinked.' : ''}`;
    }
    const patch = { ...a };
    delete patch.title_match; delete patch.name_match;
    if ('new_title' in patch) { patch.title = patch.new_title; delete patch.new_title; }
    if ('new_name' in patch) { patch.name = patch.new_name; delete patch.new_name; }
    if (kind === 'routine') {
      if (a.days) { patch.extra_date = null; patch.weekday = null; }
      if (a.extra_date) { patch.days = null; patch.weekday = null; }
    }
    if (kind === 'reminder' && 'due_at' in patch) {
      patch.snoozed_until = null;
      patch.fired_at = null;
    }
    if ('status' in patch && ['task','project','goal'].includes(kind)) {
      patch.completed_at = patch.status === 'completed' ? new Date().toISOString() : null;
      if (kind === 'task') patch.completed_at_date = patch.status === 'completed' ? todayStr() : null;
    }
    await adapter.update(row.id, patch);
    if (['task','reminder','routine'].includes(kind)) alarmRefresh();
    return `Updated ${kind}: ${describe({ ...row, ...patch })}.`;
  }
  if (['complete_task', 'set_reminder', 'set_recurrence', 'remove_recurrence'].includes(name)) {
    const task = get('task', a.title_match);
    let patch: Record<string, any>;
    if (name === 'complete_task') patch = { status: 'completed', completed_at: new Date().toISOString(), completed_at_date: todayStr() };
    else if (name === 'set_reminder') patch = { remind_me: a.remind_me, reminder_minutes: a.remind_me ? task.reminder_minutes ?? 0 : null };
    else if (name === 'remove_recurrence') patch = { recurrence: null, recurrence_days: null, recurrence_monthday: null, recurrence_anchor: null };
    else {
      const base = task.due_date ? new Date(task.due_date + 'T00:00:00') : new Date();
      patch = { recurrence: a.rule === 'weekdays' ? 'weekly' : a.rule, recurrence_days: a.rule === 'weekdays' ? [1,2,3,4,5] : a.rule === 'weekly' ? a.days ?? [base.getDay()] : null, recurrence_monthday: a.rule === 'monthly' ? base.getDate() : null, recurrence_anchor: task.recurrence_anchor ?? task.due_date ?? todayStr() };
    }
    await db.updateTask(task.id, patch);
    alarmRefresh();
    if (name === 'set_reminder') return `Reminder preference ${a.remind_me ? 'on' : 'off'} for “${label(task)}”.${a.remind_me && !task.due_time ? ' Add a time for a timed alarm.' : ''}`;
    if (name === 'set_recurrence') return `“${label(task)}” now repeats ${a.rule}.`;
    if (name === 'remove_recurrence') return `“${label(task)}” no longer repeats.`;
    return `Completed “${label(task)}”.`;
  }
  if (name === 'idea_to_project') {
    const idea = get('idea', a.title_match);
    if (idea.converted_project_id) throw new Error('That idea has already been converted to a project.');
    const project = await db.convertIdeaToProject(idea.id);
    if (!project) throw new Error('The idea could not be converted.');
    return `Created project “${project.name}” from your idea.`;
  }
  if (name === 'navigate') {
    const tab = a.tab ?? (['notes','ideas','remember'].includes(a.page) ? a.page : null);
    if (tab) { (window as any).__lifeosLibraryTab = tab; window.dispatchEvent(new CustomEvent('lifeos-library-tab', { detail: tab })); }
    ctx.navigate(tab ? 'library' : a.page);
    return `Opened ${tab ?? a.page}.`;
  }
  if (name === 'open_capture') { window.dispatchEvent(new CustomEvent('lifeos-open-capture')); return 'Opening idea capture. You can add a photo or a note there.'; }
  if (name === 'open_app') { window.focus(); return 'LifeOS is already open here.'; }
  if (name === 'summarize_day') {
    const tasks = adapters.task.rows.filter(t => t.due_date === todayStr() && t.status !== 'completed');
    const reminders = adapters.reminder.rows.filter(r => !r.done && new Date(r.due_at).toDateString() === new Date().toDateString());
    return `Today you have ${tasks.length} outstanding tasks and ${reminders.length} reminders.${tasks.length ? ' ' + tasks.slice(0,5).map(describe).join('; ') + '.' : ''}`;
  }
  if (name === 'capabilities') return `I can add, find, edit and delete tasks, subtasks, notes, ideas, remember items, reminders, routines, projects, goals, milestones, tags, categories and planner blocks. I can manage task recurrence and relationships, attach or detach task tags, snooze reminders, complete one-off reminders, convert ideas to projects and open app pages. ${UNSUPPORTED_CONTROLS}`;
  throw new Error('That control is not supported.');
}
