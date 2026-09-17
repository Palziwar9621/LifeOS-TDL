// LifeOS — Weekly Plan panel: time blocks per weekday (schedule ≠ tasks).
// Embedded as a view inside the Productivity page (merged nav); still fully functional.
import React, { useState } from 'react';
import { Icon, Modal, EmptyState } from '../../ui/components';
import { dbState, createScheduleBlock, updateScheduleBlock, deleteScheduleBlock } from '../../lib/db';
import { fmtTime, todayStr } from '../../lib/dates';
import { useConfirm } from '../../ui/components';
import type { ScheduleBlock } from '../../lib/types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function WeeklyPlanPanel() {
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<ScheduleBlock | 'new' | null>(null);
  const todayDow = parseDateStr(todayStr()).getDay();

  const blocksByDay = (dow: number) =>
    s.schedule_blocks.filter((b) => !b.deleted && b.weekday === dow).sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">Time you've allocated. Tasks are separate — link them if you like.</p>
        <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> Add block</button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
          <div key={dow} className={`card p-3 ${dow === todayDow ? 'ring-2 ring-brand-500' : ''}`}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide">{DAY_NAMES[dow].slice(0, 3)}</h2>
              <button className="btn-ghost btn-sm !px-1.5" aria-label={`Add block on ${DAY_NAMES[dow]}`} onClick={() => { pendingDow = dow; setEditing('new'); }}>
                <Icon name="plus" className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              {blocksByDay(dow).length === 0 && <p className="py-3 text-center text-xs muted">—</p>}
              {blocksByDay(dow).map((b) => (
                <button key={b.id}
                  className="block w-full rounded-lg px-2.5 py-2 text-left text-white shadow-sm transition hover:brightness-110"
                  style={{ background: b.color }}
                  onClick={() => setEditing(b)}>
                  <p className="truncate text-xs font-bold">{b.title}</p>
                  <p className="text-[10px] text-white/85">{fmtTime(b.start_time)} – {fmtTime(b.end_time)}</p>
                  {b.linked_task_id && <p className="mt-0.5 text-[10px] text-white/75">↔ linked task</p>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && <BlockEditor block={editing === 'new' ? null : editing} defaultDow={editing === 'new' ? (pendingDow ?? undefined) : undefined} onClose={() => { setEditing(null); pendingDow = null; }} />}
      {confirmEl}
    </div>
  );
}

let pendingDow: number | null = null;

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function BlockEditor({ block, defaultDow, onClose }: { block: ScheduleBlock | null; defaultDow?: number; onClose: () => void }) {
  const s = dbState();
  const { toast } = { toast: (m: string, k?: any) => console.log(m) };
  const [title, setTitle] = useState(block?.title ?? '');
  const [weekdays, setWeekdays] = useState<number[]>([block?.weekday ?? defaultDow ?? 1]);
  const [start, setStart] = useState((block?.start_time ?? '09:00:00').slice(0, 5));
  const [end, setEnd] = useState((block?.end_time ?? '10:00:00').slice(0, 5));
  const [color, setColor] = useState(block?.color ?? '#6366f1');
  const [notes, setNotes] = useState(block?.notes ?? '');
  const [linkedTaskId, setLinkedTaskId] = useState(block?.linked_task_id ?? '');
  const [recurrence, setRecurrence] = useState(block?.recurrence ?? 'weekly');

  const tasks = s.tasks.filter((t) => !t.deleted && t.status !== 'completed').slice(0, 100);
  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? (prev.length > 1 ? prev.filter((x) => x !== d) : prev) : [...prev, d].sort()));

  const save = async () => {
    if (!title.trim()) return;
    // Multi-day: create one block per picked day (edit keeps its own day).
    if (block) {
      await updateScheduleBlock(block.id, {
        title: title.trim(), weekday: weekdays[0], start_time: start + ':00', end_time: end + ':00',
        color, notes: notes || null,
        linked_task_id: linkedTaskId || null,
        recurrence,
      });
      toast('Block updated');
      onClose();
      return;
    }
    for (const d of weekdays) {
      await createScheduleBlock({
        title: title.trim(), weekday: d, start_time: start + ':00', end_time: end + ':00',
        color, notes: notes || null,
        linked_task_id: linkedTaskId || null,
        recurrence,
      } as any);
    }
    toast(weekdays.length > 1 ? `Block added to ${weekdays.length} days` : 'Block added');
    onClose();
  };

  const remove = async () => {
    if (!block) return;
    await deleteScheduleBlock(block.id);
    toast('Block deleted');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={block ? 'Edit block' : 'New schedule block'}>
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gym / College / Deep work" autoFocus />
        </div>
        <div>
          <label className="label">Days <span className="muted font-normal">(tap to pick several — e.g. Mon + Tue + Wed)</span></label>
          <div className="grid grid-cols-7 gap-1">
            {DAY_NAMES.map((n, i) => (
              <button key={n} type="button" onClick={() => toggleDay(i)}
                className={`rounded-lg py-2 text-xs font-bold transition ${weekdays.includes(i) ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                aria-pressed={weekdays.includes(i)}>
                {n.slice(0, 3)}
              </button>
            ))}
          </div>
          {!block && weekdays.length > 1 && (
            <p className="mt-1.5 text-xs muted">Creates {weekdays.length} blocks — one per day, same time.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start</label>
            <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">End</label>
            <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b'].map((c) => (
                <button key={c} className={`h-8 w-8 rounded-full ring-2 ${color === c ? 'ring-slate-900 dark:ring-white' : 'ring-transparent'}`}
                  style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
              ))}
            </div>
          </div>
          <div>
            <label className="label">Repeats</label>
            <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)}>
              <option value="weekly">Every week</option>
              <option value="daily">Every day</option>
              <option value="even_weeks">Even weeks</option>
              <option value="odd_weeks">Odd weeks</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Link a task (optional)</label>
          <select className="input" value={linkedTaskId} onChange={(e) => setLinkedTaskId(e.target.value)}>
            <option value="">No linked task</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <p className="mt-1 text-xs muted">A schedule block is time you've set aside — not a to-do itself.</p>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-between gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          {block ? <button className="btn-danger btn-sm" onClick={() => void remove()}>Delete</button> : <span />}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
