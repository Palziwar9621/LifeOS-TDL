// LifeOS — date helpers (all dates are local, yyyy-MM-dd strings)

export const todayStr = (): string => toLocalDateStr(new Date());

export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseDateStr(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toLocalDateStr(d);
}

export function addYears(s: string, n: number): string {
  return addMonths(s, n * 12);
}

export function startOfWeek(s: string, weekStartsOn = 1): string {
  const d = parseDateStr(s);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

export function diffDays(a: string, b: string): number {
  const da = parseDateStr(a).getTime();
  const db = parseDateStr(b).getTime();
  return Math.round((da - db) / 86400000);
}

export function fmtDate(s: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!s) return '';
  return parseDateStr(s).toLocaleDateString(undefined, opts ?? { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateShort(s: string | null | undefined): string {
  if (!s) return '';
  return parseDateStr(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "today", "tomorrow", "yesterday", "in 3d", "5d ago", or a short date */
export function relativeDay(s: string | null | undefined): string {
  if (!s) return '';
  const d = diffDays(s, todayStr());
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return parseDateStr(s).toLocaleDateString(undefined, { weekday: 'long' });
  if (d < 0) return `${-d}d overdue`;
  return fmtDateShort(s);
}

/** HH:mm:ss / HH:mm → "7:00 PM" (local) */
export function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function minutesFromTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function timeFromMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** Combine date + time into a Date (local). time may be HH:mm or HH:mm:ss. */
export function dateTimeFrom(date: string, time?: string | null): Date {
  const [y, mo, d] = date.split('-').map(Number);
  let h = 9, mi = 0;
  if (time) {
    const parts = time.split(':').map(Number);
    h = parts[0] ?? 9; mi = parts[1] ?? 0;
  }
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

/** ISO datetime (local) → "yyyy-MM-ddTHH:mm" for <input type="datetime-local"> */
export function toLocalIso(d: Date): string {
  return `${toLocalDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Split ISO timestamptz into local date & time strings */
export function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: toLocalDateStr(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}

export function monthLabel(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function weekdayNames(weekStartsOn = 1): string[] {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return Array.from({ length: 7 }, (_, i) => names[(weekStartsOn + i) % 7]);
}

export function weekdayShort(weekStartsOn = 1): string[] {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 7 }, (_, i) => names[(weekStartsOn + i) % 7]);
}

export function isOverdue(t: { due_date: string | null; due_time?: string | null; status?: string; completed_at?: string | null }): boolean {
  if (t.status === 'completed' || t.status === 'cancelled' || t.completed_at) return false;
  if (!t.due_date) return false;
  const now = new Date();
  const today = todayStr();
  if (t.due_date < today) return true;
  if (t.due_date === today && t.due_time) {
    const [h, m] = t.due_time.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() > h * 60 + m;
  }
  return false;
}
