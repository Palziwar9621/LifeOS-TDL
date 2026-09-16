// LifeOS — recurrence engine for repeating tasks
import type { Task, Recurrence } from './types';
import { addDays, addMonths, addYears, parseDateStr, todayStr, diffDays } from './dates';

/** Compute the next occurrence date on/after `from` for a recurring task */
export function nextOccurrence(t: Pick<Task, 'recurrence' | 'recurrence_days' | 'recurrence_monthday'>, from: string): string | null {
  const r = t.recurrence;
  if (!r) return null;
  if (r === 'daily') return from;
  if (r === 'weekdays') {
    let d = from;
    for (let i = 0; i < 8; i++) {
      const dow = parseDateStr(d).getDay();
      if (dow >= 1 && dow <= 5) return d;
      d = addDays(d, 1);
    }
    return d;
  }
  if (r === 'weekly') {
    const days = (t.recurrence_days && t.recurrence_days.length ? [...t.recurrence_days] : [parseDateStr(from).getDay()]).sort();
    let d = from;
    for (let i = 0; i < 15; i++) {
      const dow = parseDateStr(d).getDay();
      if (days.includes(dow)) return d;
      d = addDays(d, 1);
    }
    return d;
  }
  if (r === 'monthly') {
    const md = t.recurrence_monthday ?? parseDateStr(from).getDate();
    if (from.slice(8) === String(md).padStart(2, '0')) {
      // same day-of-month — accept if valid (e.g. 31st may not exist this month)
      const candidate = `${from.slice(0, 8)}${String(md).padStart(2, '0')}`;
      if (candidate === from) return from;
    }
    let probe = from;
    for (let i = 0; i < 13; i++) {
      probe = addMonths(probe, 1);
      const last = new Date(parseDateStr(probe).getFullYear(), parseDateStr(probe).getMonth() + 1, 0).getDate();
      if (md <= last) return `${probe.slice(0, 8)}${String(md).padStart(2, '0')}`;
    }
    return null;
  }
  if (r === 'yearly') return from;
  if (r === 'custom') {
    // custom = specific weekdays (same as weekly)
    const days = (t.recurrence_days && t.recurrence_days.length ? t.recurrence_days : [parseDateStr(from).getDay()]);
    let d = from;
    for (let i = 0; i < 15; i++) {
      if (days.includes(parseDateStr(d).getDay())) return d;
      d = addDays(d, 1);
    }
    return d;
  }
  return null;
}

/** All occurrence dates for a task within [start, end], local dates */
export function occurrencesBetween(t: Task, start: string, end: string): string[] {
  const out: string[] = [];
  if (t.deleted || t.archived) return out;
  if (!t.recurrence) {
    if (t.due_date && t.due_date >= start && t.due_date <= end) out.push(t.due_date);
    return out;
  }
  const anchor = t.recurrence_anchor ?? t.due_date ?? todayStr();
  if (anchor > end) return out;
  // cap: scan at most ~2 years from anchor or from start, whichever is later
  let cur = anchor < start ? start : anchor;
  const cap = addYears(start, 2);
  const endC = end < cap ? end : cap;
  let guard = 0;
  while (cur && cur <= endC && guard++ < 800) {
    if (cur >= start && cur <= end) out.push(cur);
    const nxt = nextOccurrence(t, cur === anchor ? (cur < anchor ? anchor : cur) : addDays(cur, 1));
    if (!nxt) break;
    cur = nxt > cur ? nxt : addDays(cur, 1);
  }
  return out;
}

/** Effective due date for a task's "instance" on a given day (non-recurring: just due_date) */
export function occurrenceDueDate(t: Task, occ: string): string {
  const ov = t.occurrence_overrides?.[occ];
  if (ov?.due_date !== undefined) return ov.due_date ?? t.due_date ?? occ;
  return occ;
}

/** Has this occurrence been completed? */
export function isOccurrenceDone(t: Task, occ: string): boolean {
  return !!t.completed_occurrences?.[occ];
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  daily: 'Daily', weekdays: 'Weekdays (Mon–Fri)', weekly: 'Weekly',
  monthly: 'Monthly', yearly: 'Yearly', custom: 'Custom…',
};

export function recurrenceSummary(t: Pick<Task, 'recurrence' | 'recurrence_days' | 'recurrence_monthday'>): string | null {
  if (!t.recurrence) return null;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (t.recurrence === 'daily') return 'Every day';
  if (t.recurrence === 'weekdays') return 'Weekdays';
  if (t.recurrence === 'weekly' || t.recurrence === 'custom') {
    if (t.recurrence_days?.length) {
      return t.recurrence === 'custom'
        ? `Every ${t.recurrence_days.map((d) => names[d]).join(', ')}`
        : `Weekly on ${t.recurrence_days.map((d) => names[d]).join(', ')}`;
    }
    return t.recurrence === 'custom' ? 'Custom' : 'Weekly';
  }
  if (t.recurrence === 'monthly') return t.recurrence_monthday ? `Monthly on day ${t.recurrence_monthday}` : 'Monthly';
  return 'Yearly';
}
