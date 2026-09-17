// LifeOS — Calendar: day / week / month views
import React, { useMemo, useState } from 'react';
import { Icon, EmptyState } from '../../ui/components';
import { dbState } from '../../lib/db';
import { todayStr, addDays, startOfWeek, parseDateStr, fmtTime, toLocalDateStr, monthLabel, weekdayShort, relativeDay, dateTimeFrom } from '../../lib/dates';
import { occurrencesBetween, isOccurrenceDone } from '../../lib/recurrence';
import type { Task } from '../../lib/types';
import { TaskEditor } from '../TaskEditor';
import { useApp } from '../store';

interface CalItem {
  kind: 'task' | 'block' | 'reminder' | 'milestone';
  id: string;
  title: string;
  time?: string;
  date: string;
  color: string;
  icon: string;
  task?: Task;
  occ?: string;
}

type CalFilter = 'task' | 'block' | 'reminder' | 'milestone';
const FILTER_LABEL: Record<CalFilter, { label: string; icon: string; color: string }> = {
  task: { label: 'Tasks', icon: 'check', color: '#6366f1' },
  block: { label: 'Blocks', icon: 'clock', color: '#0ea5e9' },
  reminder: { label: 'Reminders', icon: 'bell', color: '#f59e0b' },
  milestone: { label: 'Milestones', icon: 'flag', color: '#8b5cf6' },
};
const FILTERS_KEY = 'lifeos.calendar.filters';
function loadFilters(): Set<CalFilter> {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) return new Set(JSON.parse(raw) as CalFilter[]);
  } catch { /* ignore */ }
  return new Set(['task', 'block', 'reminder', 'milestone']);
}

export function CalendarPage() {
  const s = dbState();
  const { version } = useApp();
  const today = todayStr();
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [cursor, setCursor] = useState(today);
  const [editing, setEditing] = useState<Task | null>(null);
  const [filters, setFilters] = useState<Set<CalFilter>>(loadFilters);

  const toggleFilter = (f: CalFilter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      try { localStorage.setItem(FILTERS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    const push = (date: string, item: CalItem) => {
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(item);
    };

    const rangeStart = view === 'day' ? cursor : view === 'week' ? startOfWeek(cursor, 1) : `${cursor.slice(0, 7)}-01`;
    const rangeEnd = view === 'day' ? cursor : view === 'week' ? addDays(startOfWeek(cursor, 1), 6) : (() => {
      const [y, m] = cursor.split('-').map(Number);
      return toLocalDateStr(new Date(y, m, 0));
    })();

    for (const t of s.tasks) {
      if (!filters.has('task') || t.deleted || t.archived) continue;
      if (t.status === 'cancelled') continue;
      const cat = s.categories.find((c) => c.id === t.category_id);
      const proj = s.projects.find((p) => p.id === t.project_id);
      const color = t.priority === 'urgent' ? '#dc2626' : t.priority === 'high' ? '#ea580c' : cat?.color ?? proj?.color ?? '#6366f1';
      if (t.recurrence) {
        for (const occ of occurrencesBetween(t, rangeStart, rangeEnd)) {
          if (isOccurrenceDone(t, occ)) continue;
          push(occ, { kind: 'task', id: t.id + ':' + occ, title: t.title, time: t.due_time ?? undefined, date: occ, color, icon: 'check', task: t, occ });
        }
      } else if (t.due_date && t.due_date >= rangeStart && t.due_date <= rangeEnd) {
        if (t.status === 'completed') continue;
        push(t.due_date, { kind: 'task', id: t.id, title: t.title, time: t.due_time ?? undefined, date: t.due_date, color, icon: 'check', task: t });
      }
    }
    for (const b of s.schedule_blocks) {
      if (!filters.has('block') || b.deleted) continue;
      // blocks repeat weekly — paint over range if weekday matches
      let d = rangeStart;
      while (d <= rangeEnd) {
        if (parseDateStr(d).getDay() === b.weekday) {
          push(d, { kind: 'block', id: b.id, title: b.title, time: b.start_time, date: d, color: b.color, icon: 'clock' });
        }
        d = addDays(d, 1);
      }
    }
    for (const r of s.reminders) {
      if (!filters.has('reminder') || r.done || r.deleted) continue;
      const { date, time } = splitIsoLocal(r.due_at);
      if (date >= rangeStart && date <= rangeEnd) {
        push(date, { kind: 'reminder', id: r.id, title: r.title, time, date, color: '#f59e0b', icon: 'bell' });
      }
    }
    for (const m of s.project_milestones) {
      if (!filters.has('milestone') || m.done || !m.due_date) continue;
      if (m.due_date >= rangeStart && m.due_date <= rangeEnd) {
        const p = s.projects.find((x) => x.id === m.project_id);
        push(m.due_date, { kind: 'milestone', id: m.id, title: '⚑ ' + m.title, date: m.due_date, color: p?.color ?? '#8b5cf6', icon: 'flag' });
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
    }
    return map;
  }, [s, cursor, view, version, filters]);

  const move = (dir: number) => {
    if (view === 'day') setCursor(addDays(cursor, dir));
    else if (view === 'week') setCursor(addDays(cursor, dir * 7));
    else {
      const [y, m] = cursor.split('-').map(Number);
      const nd = new Date(y, m - 1 + dir, 1);
      setCursor(toLocalDateStr(nd));
    }
  };

  const headerLabel = view === 'month'
    ? monthLabel(...(cursor.split('-').map(Number).slice(0, 2) as [number, number]))
    : view === 'week'
      ? `${fmtShort(startOfWeek(cursor, 1))} – ${fmtShort(addDays(startOfWeek(cursor, 1), 6))}`
      : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} className={`px-3.5 py-2 text-sm font-semibold capitalize ${view === v ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Show/hide item types — remembered across visits */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABEL) as CalFilter[]).map((f) => {
          const on = filters.has(f);
          const meta = FILTER_LABEL[f];
          return (
            <button key={f} onClick={() => toggleFilter(f)} aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ring-1 ${
                on
                  ? 'ring-slate-900/10 bg-slate-900/5 dark:bg-white/10 dark:ring-white/10'
                  : 'opacity-40 ring-transparent bg-transparent'}
              `}
              title={on ? `Hide ${meta.label}` : `Show ${meta.label}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? meta.color : '#94a3b8' }} />
              {meta.label}
            </button>
          );
        })}
      </div>

      <div className="card mb-4 flex items-center justify-between px-4 py-3">
        <button className="btn-ghost btn-sm" onClick={() => move(-1)} aria-label="Previous"><Icon name="chevronL" className="h-4 w-4" /></button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold">{headerLabel}</span>
          <button className="chip chip-brand" onClick={() => setCursor(today)}>Today</button>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => move(1)} aria-label="Next"><Icon name="chevronR" className="h-4 w-4" /></button>
      </div>

      {view === 'day' && <DayView date={cursor} items={itemsByDate.get(cursor) ?? []} onEdit={setEditing} />}
      {view === 'week' && <WeekView cursor={cursor} itemsByDate={itemsByDate} onEdit={setEditing} />}
      {view === 'month' && <MonthView cursor={cursor} today={today} itemsByDate={itemsByDate} onPick={(d) => { setCursor(d); setView('day'); }} />}

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function splitIsoLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function fmtShort(s: string) {
  return parseDateStr(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ItemChip({ item, onEdit }: { item: CalItem; onEdit: (t: Task) => void }) {
  return (
    <button
      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs font-medium text-white/95 transition hover:brightness-110"
      style={{ background: item.color }}
      onClick={() => item.task && onEdit(item.task)}
      title={item.title}
    >
      <span className="shrink-0">{item.kind === 'block' ? '🕐' : item.kind === 'reminder' ? '🔔' : item.kind === 'milestone' ? '⚑' : '✓'}</span>
      <span className="truncate">{item.time ? fmtTime(item.time.length === 5 ? item.time + ':00' : item.time) + ' ' : ''}{item.title}</span>
    </button>
  );
}

function DayView({ date, items, onEdit }: { date: string; items: CalItem[]; onEdit: (t: Task) => void }) {
  return (
    <div className="card p-5">
      <h2 className="mb-3 font-bold">{parseDateStr(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      {items.length === 0 ? <EmptyState icon="calendar" title="Nothing planned" hint="This day is wide open." /> : (
        <div className="space-y-1.5">
          {items.map((i) => <ItemChip key={i.kind + i.id} item={i} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

function WeekView({ cursor, itemsByDate, onEdit }: { cursor: string; itemsByDate: Map<string, CalItem[]>; onEdit: (t: Task) => void }) {
  const start = startOfWeek(cursor, 1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const names = weekdayShort(1);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
      {days.map((d, i) => (
        <div key={d} className={`card min-h-36 p-2.5 ${d === todayStr() ? 'ring-2 ring-brand-500' : ''}`}>
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide muted">{names[i]} {fmtShort(d).split(' ')[1]}</p>
          <div className="space-y-1">
            {(itemsByDate.get(d) ?? []).slice(0, 6).map((it) => <ItemChip key={it.kind + it.id} item={it} onEdit={onEdit} />)}
            {(itemsByDate.get(d) ?? []).length > 6 && (
              <p className="text-center text-[10px] muted">+{(itemsByDate.get(d) ?? []).length - 6} more</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthView({ cursor, today, itemsByDate, onPick }: { cursor: string; today: string; itemsByDate: Map<string, CalItem[]>; onPick: (d: string) => void }) {
  const [y, m] = cursor.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${cursor.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const names = weekdayShort(1);
  return (
    <div className="card overflow-hidden p-3">
      <div className="grid grid-cols-7 gap-1 pb-2">
        {names.map((n) => <p key={n} className="text-center text-[10px] font-bold uppercase muted">{n[0]}{n[1]}{n[2]}</p>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, idx) => d === null ? <div key={'x' + idx} /> : (
          <button key={d}
            className={`min-h-20 rounded-xl p-1.5 text-left align-top transition hover:bg-slate-100 dark:hover:bg-slate-800 ${d === today ? 'ring-2 ring-brand-500' : ''}`}
            onClick={() => onPick(d)}>
            <span className={`text-xs font-bold ${d === today ? 'text-brand-600' : ''}`}>{parseInt(d.slice(8), 10)}</span>
            <div className="mt-1 space-y-0.5">
              {(itemsByDate.get(d) ?? []).slice(0, 3).map((it) => (
                <div key={it.kind + it.id} className="h-1.5 w-full rounded-full" style={{ background: it.color }} title={it.title} />
              ))}
              {(itemsByDate.get(d) ?? []).length > 3 && <p className="text-[9px] muted">+{(itemsByDate.get(d) ?? []).length - 3}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
