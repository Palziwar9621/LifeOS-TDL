// LifeOS — full task editor
import React, { useEffect, useState } from 'react';
import { Modal, Icon, TagInput, PriorityChip } from '../ui/components';
import { dbState, updateTask, deleteTask, createSubtask, updateSubtask, deleteSubtask, createTag, linkTaskTag, unlinkTaskTag, completeTask, uncompleteTask } from '../lib/db';
import type { Task, Priority, TaskStatus } from '../lib/types';
import { RECURRENCE_LABEL } from '../lib/recurrence';
import { PRIORITY_LABEL } from '../lib/types';
import { useApp } from './store';

export function TaskEditor({ task, onClose, saved }: { task: Task | null; onClose: () => void; saved?: () => void }) {
  const { toast, navigate } = useApp();
  const s = dbState();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [status, setStatus] = useState<TaskStatus>('inbox');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [startTime, setStartTime] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState('');
  const [estimated, setEstimated] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [recDays, setRecDays] = useState<number[]>([]);
  const [recMonthday, setRecMonthday] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [subtasks, setSubtasks] = useState<{ id?: string; title: string; done: boolean; deleteMe?: boolean }[]>([]);
  const [subInput, setSubInput] = useState('');

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes ?? '');
    setPriority(task.priority);
    setStatus(task.status);
    setDueDate(task.due_date ?? '');
    setDueTime(task.due_time?.slice(0, 5) ?? '');
    setStartTime(task.start_time?.slice(0, 5) ?? '');
    setCategoryId(task.category_id ?? '');
    setProjectId(task.project_id ?? '');
    setGoalId(task.goal_id ?? '');
    setReminderMinutes(task.reminder_minutes?.toString() ?? '');
    setEstimated(task.estimated_minutes?.toString() ?? '');
    setRecurrence(task.recurrence ?? '');
    setRecDays(task.recurrence_days ?? []);
    setRecMonthday(task.recurrence_monthday?.toString() ?? '');
    setTagIds(s.task_tags.filter((tt) => tt.task_id === task.id).map((tt) => tt.tag_id));
    setSubtasks(dbState().subtasks.filter((x) => x.task_id === task.id).map((x) => ({ id: x.id, title: x.title, done: x.done })));
  }, [task]);

  const save = async () => {
    if (!task) return;
    if (!title.trim()) { toast('Please give the task a title', 'error'); return; }
    try {
      await updateTask(task.id, {
        title: title.trim(),
        notes: notes || null,
        priority,
        status,
        due_date: dueDate || null,
        due_time: dueTime ? dueTime + ':00' : null,
        start_time: startTime ? startTime + ':00' : null,
        category_id: categoryId || null,
        project_id: projectId || null,
        goal_id: goalId || null,
        reminder_minutes: reminderMinutes ? parseInt(reminderMinutes, 10) : null,
        estimated_minutes: estimated ? parseInt(estimated, 10) : null,
        recurrence: recurrence || null,
        recurrence_days: recurrence === 'weekly' || recurrence === 'custom' ? (recDays.length ? recDays : null) : null,
        recurrence_monthday: recurrence === 'monthly' && recMonthday ? parseInt(recMonthday, 10) : null,
        recurrence_anchor: dueDate || task.recurrence_anchor,
      } as any);
      // tags
      const current = s.task_tags.filter((tt) => tt.task_id === task.id).map((tt) => tt.tag_id);
      for (const tid of tagIds) if (!current.includes(tid)) await linkTaskTag(task.id, tid);
      for (const tid of current) if (!tagIds.includes(tid)) await unlinkTaskTag(task.id, tid);
      // subtasks
      for (const st of subtasks) {
        if (st.id) {
          await updateSubtask(st.id, { title: st.title, done: st.done });
        } else if (st.title.trim()) {
          await createSubtask(task.id, st.title);
        }
        if (st.deleteMe) await deleteSubtask(st.id!);
      }
      toast('Task saved', 'success');
      saved?.();
      onClose();
    } catch (e: any) {
      toast(e?.message ?? 'Could not save task', 'error');
    }
  };

  const addTag = async () => {
    const name = newTag.trim().replace(/^#/, '');
    if (!name) return;
    const tag = await createTag(name);
    setTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
    setNewTag('');
  };

  if (!task) return null;
  const projects = s.projects.filter((p) => !p.archived);
  const goals = s.goals.filter((g) => g.status === 'active');

  return (
    <Modal open={!!task} onClose={onClose} title="Edit task" wide>
      <div className="space-y-4">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Due time</label>
            <input type="time" className="input" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
          <div>
            <label className="label">Start time (optional)</label>
            <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {(['inbox', 'planned', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map((st) => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Project</label>
            <select className="input" value={ projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Goal</label>
            <select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">None</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reminder (minutes before)</label>
            <select className="input" value={reminderMinutes} onChange={(e) => setReminderMinutes(e.target.value)}>
              <option value="">None</option>
              {[10, 15, 30, 60, 120, 1440].map((m) => <option key={m} value={m}>{m >= 1440 ? '1 day before' : `${m} min before`}</option>)}
            </select>
    </div>
          <div>
            <label className="label">Estimated duration (min)</label>
            <input type="number" min={0} className="input" value={estimated} onChange={(e) => setEstimated(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {/* Recurrence */}
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/60 p-3.5">
          <label className="label">Repeat</label>
          <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
            <option value="">Does not repeat</option>
            {Object.entries(RECURRENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {(recurrence === 'weekly' || recurrence === 'custom') && (
            <div className="mt-2.5">
              <div className="flex gap-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <button key={i} type="button"
                    className={`h-8 w-8 rounded-full text-xs font-bold ${recDays.includes(i) ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-700'}`}
                    onClick={() => setRecDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          {recurrence === 'monthly' && (
            <input type="number" min={1} max={31} className="input mt-2.5" placeholder="Day of month (1–31)"
              value={recMonthday} onChange={(e) => setRecMonthday(e.target.value)} />
          )}
          {task.recurrence && (
            <p className="mt-2 text-xs muted">
              This task repeats. Completions are tracked per occurrence, so finishing today doesn't remove future dates.
            </p>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="label">Tags</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white dark:bg-slate-800 px-3 py-2 ring-1 ring-slate-900/10 dark:ring-white/10">
            {tagIds.map((tid) => {
              const t = s.tags.find((x) => x.id === tid);
              if (!t) return null;
              return (
                <span key={tid} className="chip chip-brand">
                  #{t.name}
                  <button onClick={() => setTagIds((prev) => prev.filter((x) => x !== tid))} aria-label={`Remove ${t.name}`}><Icon name="x" className="h-3 w-3" /></button>
                </span>
              );
            })}
            <input
              className="min-w-24 flex-1 bg-transparent text-sm outline-none"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTag(); } }}
              placeholder="Add tag + Enter"
            />
            </div>
        </div>

        {/* Subtasks */}
        <div>
          <label className="label">Subtasks</label>
          <div className="space-y-1.5">
            {subtasks.map((st, i) => (
              <div key={st.id ?? `new-${i}`} className="flex items-center gap-2">
                <input type="checkbox" checked={st.done} className="checkbox-tap"
                  onChange={(e) => setSubtasks((prev) => prev.map((x, j) => j === i ? { ...x, done: e.target.checked } : x))} />
                <input className="input flex-1 !py-1.5" value={st.title}
                  onChange={(e) => setSubtasks((prev) => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <button className="btn-ghost btn-sm text-rose-500" aria-label="Remove subtask"
                  onClick={() => setSubtasks((prev) => prev.map((x, j) => j === i ? { ...x, deleteMe: true } : x))}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input flex-1" placeholder="Add subtask + Enter"
              value={subInput}
              onChange={(e) => setSubInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && subInput.trim()) {
                  e.preventDefault();
                  setSubtasks((prev) => [...prev, { title: subInput.trim(), done: false }]);
                  setSubInput('');
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          <button className="btn-danger btn-sm" onClick={handleDelete}>Delete</button>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );

  async function handleDelete() {
    await deleteTask(task!.id);
    toast('Task deleted', 'success');
    saved?.();
    onClose();
  }
}
