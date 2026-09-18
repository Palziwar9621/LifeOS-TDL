// LifeOS — Quick Add with smart parsing
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Icon, PriorityChip } from '../ui/components';
import { parseQuickAdd } from '../lib/quickadd';
import { createTask, createNote, createReminder, createProject, createGoal, dbState } from '../lib/db';
import { useApp } from './store';
import { fmtDate, todayStr } from '../lib/dates';
import type { Priority, Recurrence } from '../lib/types';

type QuickKind = 'task' | 'note' | 'reminder' | 'project' | 'goal';

export function QuickAddModal({ open, onClose, initialKind = 'task' as QuickKind, presetDate }: {
  open: boolean; onClose: () => void; initialKind?: QuickKind; presetDate?: string;
}) {
  const { toast } = useApp();
  const [kind, setKind] = useState<QuickKind>(initialKind);
  const [text, setText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [priority, setPriority] = useState<Priority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence | ''>('');
  const [recDays, setRecDays] = useState<number[]>([]);

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setText('');
      setPriority('');
      setDueDate(presetDate ?? '');
      setDueTime('');
      setRecurrence('');
      setRecDays([]);
      setShowAdvanced(false);
      setTimeout(() => document.getElementById('qa-input')?.focus(), 50);
    }
  }, [open, initialKind, presetDate]);

  const parsed = useMemo(() => (kind === 'task' && text.trim() ? parseQuickAdd(text) : null), [kind, text]);

  const state = dbState();
  const cats = state.categories;
  const projects = state.projects.filter((p) => !p.archived);

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      if (kind === 'task') {
        const p = parseQuickAdd(value);
        const categoryId = p.categoryHint
          ? cats.find((c) => c.name.toLowerCase() === p.categoryHint!.toLowerCase())?.id ?? null
          : null;
        const projectId = p.projectHint
          ? projects.find((pr) => pr.name.toLowerCase().includes(p.projectHint!.toLowerCase()))?.id ?? null
          : null;
        await createTask({
          title: p.title,
          due_date: dueDate || p.due_date || todayStr(),
          due_time: dueTime || p.due_time,
          priority: (priority || p.priority || 'medium') as Priority,
          recurrence: recurrence || p.recurrence,
          recurrence_days: recurrence === 'weekly' ? recDays : p.recurrence_days,
          recurrence_anchor: (dueDate || p.due_date) ?? undefined,
          reminder_minutes: p.reminder_minutes,
          estimated_minutes: p.estimated_minutes,
          category_id: categoryId,
          project_id: projectId,
        });
        toast('Task added', 'success');
      } else if (kind === 'note') {
        const [first, ...rest] = value.split('\n');
        await createNote({ title: first.slice(0, 80), content: rest.join('\n') });
        toast('Note added', 'success');
      } else if (kind === 'reminder') {
        const p = parseQuickAdd(value);
        const at = p.due_date && p.due_time
          ? new Date(`${p.due_date}T${p.due_time.slice(0, 5)}`).toISOString()
          : new Date(Date.now() + 3600_000).toISOString();
        await createReminder({ title: p.title, due_at: at, priority: (priority || 'medium') as Priority });
        toast('Reminder set', 'success');
      } else if (kind === 'project') {
        await createProject({ name: value });
        toast('Project created', 'success');
      } else if (kind === 'goal') {
        await createGoal({ title: value });
        toast('Goal created', 'success');
      }
      onClose();
    } catch (e: any) {
      toast(e?.message ?? 'Something went wrong', 'error');
    }
  };

  const kinds: { key: QuickKind; label: string }[] = [
    { key: 'task', label: 'Task' },
    { key: 'note', label: 'Note' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'project', label: 'Project' },
    { key: 'goal', label: 'Goal' },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Quick add">
      <div className="mb-4 flex flex-wrap gap-1">
        {kinds.map((k) => (
          <button key={k.key} className={`chip ${kind === k.key ? 'chip-brand' : ''}`} onClick={() => setKind(k.key)}>{k.label}</button>
        ))}
      </div>

      <textarea
        id="qa-input"
        className="input min-h-24 resize-y"
        placeholder={
          kind === 'task' ? 'e.g. Finish Laplace assignment tomorrow at 7 PM !high #exam every wednesday'
          : kind === 'reminder' ? 'e.g. Call the bank tomorrow at 9 am'
          : kind === 'note' ? 'First line becomes the title'
          : kind === 'project' ? 'Project name'
          : 'Goal name'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
        }}
      />

      {parsed && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="muted">Detected:</span>
          <span className="chip">{parsed.title}</span>
          {parsed.due_date && <span className="chip chip-brand">{fmtDate(parsed.due_date)}</span>}
          {parsed.due_time && <span className="chip chip-brand">{parsed.due_time.slice(0, 5)}</span>}
          {parsed.priority && <PriorityChip p={parsed.priority} />}
          {parsed.recurrence && <span className="chip chip-warn">repeats</span>}
          {parsed.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
        </div>
      )}

      {(kind === 'task' || kind === 'reminder') && (
        <div className="mt-3">
          <button className="text-xs font-semibold text-brand-600 dark:text-brand-300" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '− Hide options' : '+ More options (date, time, priority, repeat)'}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Due date</label>
                <input type="date" className="input" value={dueDate || parsed?.due_date || ''} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Time</label>
                <input type="time" className="input" value={dueTime || parsed?.due_time?.slice(0, 5) || ''} onChange={(e) => setDueTime(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label">Priority</label>
                <div className="flex gap-1.5">
                  {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
                    <button key={p} className={`chip flex-1 justify-center ${priority === p || (!priority && parsed?.priority === p) ? 'chip-brand' : ''}`}
                      onClick={() => setPriority(p)}>{p}</button>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <label className="label">Repeat</label>
                <div className="flex flex-wrap gap-1.5">
                  {['', 'daily', 'weekdays', 'weekly', 'monthly'].map((r) => (
                    <button key={r || 'none'} className={`chip ${recurrence === r ? 'chip-brand' : ''}`} onClick={() => setRecurrence(r as Recurrence | '')}>
                      {r || 'No repeat'}
                    </button>
                  ))}
                </div>
                {recurrence === 'weekly' && (
                  <div className="mt-2 flex gap-1">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                      <button key={i}
                        className={`h-8 w-8 rounded-full text-xs font-bold ${recDays.includes(i) ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
                        onClick={() => setRecDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}>
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs muted">
          <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> to add · works offline
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={!text.trim()}>Add {kind}</button>
        </div>
      </div>
    </Modal>
  );
}
