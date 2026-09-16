// LifeOS — Reminders page
import React, { useState } from 'react';
import { Icon, Modal, EmptyState, useConfirm } from '../../ui/components';
import { dbState, createReminder, updateReminder, deleteReminder, snoozeReminder, completeTask } from '../../lib/db';
import type { Reminder, Priority } from '../../lib/types';
import { useApp } from '../store';
import { requestNotificationPermission, notificationPermission } from '../../lib/notifications';
import { AlarmSoundPicker } from '../AlarmSoundPicker';

export function RemindersPage() {
  const s = dbState();
  const { toast } = useApp();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [perm, setPerm] = useState(notificationPermission());

  const list = s.reminders
    .filter((r) => !r.deleted)
    .filter((r) => filter === 'all' ? true : filter === 'done' ? r.done : !r.done)
    .sort((a, b) => (a.snoozed_until ?? a.due_at).localeCompare(b.snoozed_until ?? b.due_at));

  const enableNotifs = async () => {
    const p = await requestNotificationPermission();
    setPerm(p);
    if (p === 'granted') toast('Notifications on — you\'ll be reminded on time.', 'success');
    else toast('Notifications are blocked in your browser settings.', 'error');
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Reminders</h1>
          <p className="text-sm muted">Time-based nudges — independent of tasks.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New reminder</button>
      </div>

      {perm !== 'granted' && (
        <div className="card mb-4 flex items-center justify-between gap-3 border-l-4 border-l-amber-500 p-4">
          <div>
            <p className="text-sm font-bold">Get notified on time</p>
            <p className="text-xs muted">{perm === 'denied' ? 'Blocked in browser settings — enable notifications for this site.' : 'Allow notifications so reminders pop up even when this tab is open in the background.'}</p>
          </div>
          {perm !== 'denied' && <button className="btn-primary btn-sm" onClick={() => void enableNotifs()}>Enable</button>}
        </div>
      )}

      <div className="mb-3 flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10 md:w-fit">
        {(['open', 'done', 'all'] as const).map((f) => (
          <button key={f} className={`flex-1 px-4 py-2 text-sm font-semibold capitalize ${filter === f ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
            onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon="bell" title="No reminders" hint="Create one for anything time-based: calls, bills, medication."
          action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Set a reminder</button>} />
      ) : (
        <div className="space-y-2">
          {list.map((r) => {
            const due = new Date(r.snoozed_until ?? r.due_at);
            const past = due.getTime() < Date.now() && !r.done;
            return (
              <div key={r.id} className={`card flex items-center gap-3 px-4 py-3 ${past && !r.done ? 'ring-1 ring-amber-500/40' : ''}`}>
                <button role="checkbox" aria-checked={r.done} aria-label={`Complete ${r.title}`}
                  className={`checkbox-tap flex h-5 w-5 items-center justify-center rounded-full border-2 ${r.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}
                  onClick={() => void updateReminder(r.id, { done: !r.done })}>
                  {r.done && <Icon name="check" className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1" onClick={() => setEditing(r)}>
                  <p className={`truncate text-sm font-medium ${r.done ? 'line-through muted' : ''}`}>
                    {r.important && '⭐ '}{r.title}
                  </p>
                  <p className="text-xs muted">
                    {due.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {r.snoozed_until && ' · snoozed'}
                    {r.recurrence && ` · ↻ ${r.recurrence}`}
                  </p>
                </div>
                {!r.done && (
                  <div className="flex gap-1 max-sm:hidden">
                    <button className="btn-ghost btn-sm" title="Snooze 10 min" onClick={() => void snoozeReminder(r.id, 10)}>10m</button>
                    <button className="btn-ghost btn-sm" title="Snooze 1 hour" onClick={() => void snoozeReminder(r.id, 60)}>1h</button>
                    <button className="btn-ghost btn-sm" title="Snooze 1 day" onClick={() => void snoozeReminder(r.id, 1440)}>1d</button>
                  </div>
                )}
                <button className="btn-ghost btn-sm text-rose-500" aria-label="Delete reminder"
                  onClick={() => confirm('Delete reminder?', `“${r.title}” will be removed.`, () => void deleteReminder(r.id))}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && <ReminderEditor reminder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </div>
  );
}

function ReminderEditor({ reminder, onClose }: { reminder: Reminder | null; onClose: () => void }) {
  const s = dbState();
  const { toast } = useApp();
  const [title, setTitle] = useState(reminder?.title ?? '');
  const [notes, setNotes] = useState(reminder?.notes ?? '');
  const [date, setDate] = useState((reminder?.due_at ?? new Date(Date.now() + 3600e3).toISOString()).slice(0, 10));
  const [time, setTime] = useState((reminder?.due_at ?? new Date(Date.now() + 3600e3).toISOString()).slice(11, 16));
  const [priority, setPriority] = useState<Priority>(reminder?.priority ?? 'medium');
  const [important, setImportant] = useState(reminder?.important ?? false);
  const [alarmSound, setAlarmSound] = useState<string | null>(reminder?.alarm_sound ?? null);
  const [recurrence, setRecurrence] = useState(reminder?.recurrence ?? '');
  const [linkTask, setLinkTask] = useState(reminder?.task_id ?? '');

  const save = async () => {
    if (!title.trim()) { toast('Give the reminder a title', 'error'); return; }
    const due_at = new Date(`${date}T${time || '09:00'}`).toISOString();
    const payload = {
      title: title.trim(), notes: notes || null, due_at, priority, important,
      alarm_sound: alarmSound,
      recurrence: (recurrence || null) as any,
      task_id: linkTask || null,
    };
    if (reminder) await updateReminder(reminder.id, payload);
    else await createReminder(payload);
    toast(reminder ? 'Reminder updated' : 'Reminder set', 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={reminder ? 'Edit reminder' : 'New reminder'}>
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Time</label>
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Link to task (optional)</label>
          <select className="input" value={linkTask} onChange={(e) => setLinkTask(e.target.value)}>
            <option value="">None</option>
            {s.tasks.filter((t) => !t.deleted).slice(0, 200).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <label className="label">Repeat</label>
          <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
            <option value="">Once only</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select>
        </div>
        <div>
          <label className="label">Alarm sound <span className="muted font-normal">(click to hear it)</span></label>
          <AlarmSoundPicker value={alarmSound} onChange={setAlarmSound} allowInherit />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox-tap" checked={important} onChange={(e) => setImportant(e.target.checked)} />
          ⭐ Show in "Important reminders" on dashboard
        </label>
        <div className="flex justify-between gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          {reminder ? <button className="btn-danger btn-sm" onClick={async () => { await deleteReminder(reminder.id); onClose(); }}>Delete</button> : <span />}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
