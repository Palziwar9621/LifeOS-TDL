// LifeOS — lightweight natural-language quick-add parser (runs fully offline)
// "Finish Laplace assignment tomorrow at 7 PM !high #exam /project:College"
import type { Priority, Recurrence } from './types';
import { todayStr, addDays, parseDateStr } from './dates';

export interface ParsedQuickAdd {
  title: string;
  due_date: string | null;
  due_time: string | null;
  priority: Priority | null;
  recurrence: Recurrence | null;
  recurrence_days: number[] | null;
  tags: string[];
  projectHint: string | null;
  categoryHint: string | null;
  reminder_minutes: number | null;
  estimated_minutes: number | null;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

export function parseQuickAdd(input: string, today = todayStr()): ParsedQuickAdd {
  let text = ' ' + input.trim() + ' ';
  const res: ParsedQuickAdd = {
    title: '', due_date: null, due_time: null, priority: null, recurrence: null,
    recurrence_days: null, tags: [], projectHint: null, categoryHint: null,
    reminder_minutes: null, estimated_minutes: null,
  };

  // #tags
  const tagRe = /#([\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text))) res.tags.push(m[1].toLowerCase());
  if (res.tags.length) text = text.replace(tagRe, ' ');

  // /project:Name and /cat:Name
  const projRe = /\/(?:project|p):([\w -]+)/i;
  if (projRe.test(text)) {
    res.projectHint = text.match(projRe)![1].trim();
    text = text.replace(projRe, ' ');
  }
  const catRe = /\/(?:category|cat|c):([\w -]+)/i;
  if (catRe.test(text)) {
    res.categoryHint = text.match(catRe)![1].trim();
    text = text.replace(catRe, ' ');
  }

  // priority !urgent !high !medium !low (also !1..!4)
  const prioRe = /!(urgent|high|medium|med|low|1|2|3|4)\b/i;
  if (prioRe.test(text)) {
    const p = text.match(prioRe)![1].toLowerCase();
    res.priority = p === '1' ? 'urgent' : p === '2' ? 'high' : p === '3' ? 'medium' : p === '4' ? 'low'
      : p === 'med' ? 'medium' : (p as Priority);
    text = text.replace(prioRe, ' ');
  }

  // reminder: @remind15 (minutes before) or @15
  const remRe = /@remind(?:\s?(\d+))?/i;
  if (remRe.test(text)) {
    const g = text.match(remRe)!;
    res.reminder_minutes = g[1] ? parseInt(g[1], 10) : 15;
    text = text.replace(remRe, ' ');
  }

  // duration: ~45m / ~2h
  const durRe = /~\s?(\d+)\s?(m|min|mins|h|hr|hrs)\b/i;
  if (durRe.test(text)) {
    const g = text.match(durRe)!;
    res.estimated_minutes = /^h/i.test(g[2]) ? parseInt(g[1], 10) * 60 : parseInt(g[1], 10);
    text = text.replace(durRe, ' ');
  }

  // recurrence: every day / every monday,wednesday / every weekday(s) / daily / weekly / monthly / yearly
  const recRe = /\bevery\s+(day|weekday|weekdays|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thurs|fri|sat)\b/gi;
  const recMatches: string[] = [];
  while ((m = recRe.exec(text))) recMatches.push(m[0]);
  if (recMatches.length) {
    const joined = recMatches.join(' ').toLowerCase();
    const days: number[] = [];
    for (const rm of recMatches) {
      const w = rm.replace(/^every\s+/i, '').toLowerCase();
      if (DAY_NAMES[w] !== undefined) days.push(DAY_NAMES[w]);
    }
    if (/weekday/.test(joined)) {
      res.recurrence = 'weekdays';
    } else if (days.length) {
      res.recurrence = 'custom';
      res.recurrence_days = [...new Set(days)].sort();
      if (res.recurrence_days.length === 7) { res.recurrence = 'daily'; res.recurrence_days = null; }
    } else if (/\bday\b/.test(joined)) {
      res.recurrence = 'daily';
    } else if (/\bweek\b/.test(joined)) {
      res.recurrence = 'weekly';
    }
    for (const rm of recMatches) text = text.replace(rm, ' ');
    // "every" may also be a plain word; strip a dangling one
    text = text.replace(/\s+every\s+/gi, ' ');
  }
  const simpleRec: Array<[RegExp, Recurrence]> = [
    [/\bdaily\b/i, 'daily'], [/\bweekly\b/i, 'weekly'], [/\bmonthly\b/i, 'monthly'], [/\byearly\b/i, 'yearly'],
  ];
  for (const [re, r] of simpleRec) {
    if (re.test(text)) { res.recurrence = r; text = text.replace(re, ' '); break; }
  }

  // dates
  const t = parseDateStr(today);
  const weekdayIn = (s: string): string | null => {
    const target = DAY_NAMES[s.toLowerCase()];
    if (target === undefined) return null;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(t); d.setDate(t.getDate() + i);
      if (d.getDay() === target) {
        const y = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${mm}-${dd}`;
      }
    }
    return null;
  };

  const datePatterns: Array<[RegExp, (mm: RegExpExecArray) => string | null]> = [
    [/\btoday\b/i, () => today],
    [/\btomorrow\b|\btmrw\b/i, () => addDays(today, 1)],
    [/\bday after tomorrow\b/i, () => addDays(today, 2)],
    [/\bnext week\b/i, () => addDays(today, 7)],
    [/\bnext month\b/i, () => { const d = new Date(t); d.setMonth(d.getMonth() + 1); return toYMD(d); }],
    [/\b(in|after)\s+(\d+)\s+days?\b/i, (mm) => addDays(today, parseInt(mm[2], 10))],
    [/\b(in|after)\s+a\s+week\b/i, () => addDays(today, 7)],
    [/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i,
      (mm) => weekdayIn(mm[1])],
    [/\b(on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
      (mm) => weekdayIn(mm[2])],
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
      (mm) => monthDay(mm[1], mm[2], t)],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (mm) => slashDate(mm[1], mm[2], mm[3], t)],
  ];
  for (const [re, fn] of datePatterns) {
    const mm = re.exec(text);
    if (mm) {
      const d = fn(mm);
      if (d) { res.due_date = d; text = text.replace(mm[0], ' '); break; }
    }
  }

  // time: at 7 / at 7:30 / 7 pm / 19:00 / noon / midnight
  const timePatterns: Array<[RegExp, (mm: RegExpExecArray) => string | null]> = [
    [/\b(?:at\s?)?noon\b/i, () => '12:00:00'],
    [/\b(?:at\s?)?midnight\b/i, () => '00:00:00'],
    [/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i, (mm) => clock(mm[1], mm[2], mm[3])],
    [/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)\b/i, (mm) => clock(mm[1], mm[2], mm[3])],
    [/\b(\d{1,2})\s*(am|pm)\b/i, (mm) => clock(mm[1], undefined, mm[2])],
    [/\b([01]?\d|2[0-3]):([0-5]\d)\b/, (mm) => clock(mm[1], mm[2], undefined)],
  ];
  for (const [re, fn] of timePatterns) {
    const mm = re.exec(text);
    if (mm) {
      const tm = fn(mm);
      if (tm) { res.due_time = tm; text = text.replace(mm[0], ' '); break; }
    }
  }

  res.title = text.replace(/\s+/g, ' ').trim() || input.trim();
  return res;
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthDay(mon: string, day: string, t: Date): string | null {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mi = months.indexOf(mon.toLowerCase());
  if (mi < 0) return null;
  const d = parseInt(day, 10);
  if (d < 1 || d > 31) return null;
  let y = t.getFullYear();
  const cand = new Date(y, mi, d);
  if (cand < t) y += 1;
  return toYMD(new Date(y, mi, d));
}

function slashDate(a: string, b: string, y: string | undefined, t: Date): string | null {
  const mm = parseInt(a, 10), dd = parseInt(b, 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  let year = y ? parseInt(y.length === 2 ? '20' + y : y, 10) : t.getFullYear();
  if (!y) {
    const cand = new Date(year, mm - 1, dd);
    if (cand < t) year += 1;
  }
  return toYMD(new Date(year, mm - 1, dd));
}

function clock(h: string, m: string | undefined, ampm: string | undefined): string | null {
  let hh = parseInt(h, 10);
  if (isNaN(hh) || hh > 23) return null;
  if (ampm) {
    const pm = /pm/i.test(ampm);
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  return `${String(hh).padStart(2, '0')}:${m ?? '00'}:00`;
}
