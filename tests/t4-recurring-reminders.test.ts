import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/lib/db.ts';
import { cacheKey, idbGet } from '../src/lib/idb.ts';
import type { Reminder } from '../src/lib/types.ts';

const priorZone = process.env.TZ;
const userId = 't4-recurrence-test-guest';
const storage = new Map<string, string>();
before(async () => {
  process.env.TZ = 'UTC';
  const win = new EventTarget() as any;
  win.location = { hash: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  storage.set('lifeos.guest', '1');
  // Inert test-only configuration avoids Vite import.meta.env in Node.
  // Guest mode prevents client reads/writes to the network.
  storage.set('lifeos.supabase', JSON.stringify({ url: 'https://t4-recurrence.invalid', anonKey: 'test-only-not-a-secret' }));
  await db.initStore(userId);
});
after(async () => {
  await db.resetStore();
  if (priorZone === undefined) delete process.env.TZ;
  else process.env.TZ = priorZone;
});

function next(due_at: string, recurrence: Reminder['recurrence'], now: string, recurrence_days: number[] | null = null) {
  return db.nextReminderDue({ due_at, recurrence, recurrence_days }, new Date(now));
}

test('T4 daily completion advances at equality and early completion cannot repeat the current due date', () => {
  assert.equal(next('2026-10-10T09:12:34.500Z', 'daily', '2026-10-10T09:12:34.500Z')?.toISOString(), '2026-10-11T09:12:34.500Z');
  assert.equal(next('2026-10-20T09:00:00Z', 'daily', '2026-10-10T08:00:00Z')?.toISOString(), '2026-10-21T09:00:00.000Z');
});

test('T4 overdue daily recurrence skips missed occurrences but can still use today before its wall-clock time', () => {
  assert.equal(next('2020-01-01T09:00:00Z', 'daily', '2026-10-10T08:59:59Z')?.toISOString(), '2026-10-10T09:00:00.000Z');
  assert.equal(next('2020-01-01T09:00:00Z', 'daily', '2026-10-10T09:00:00Z')?.toISOString(), '2026-10-11T09:00:00.000Z');
});

test('T4 weekdays skip weekends; weekly without selected days keeps the original weekday', () => {
  assert.equal(next('2026-10-09T09:00:00Z', 'weekdays', '2026-10-09T10:00:00Z')?.toISOString(), '2026-10-12T09:00:00.000Z');
  for (const days of [null, []]) {
    assert.equal(next('2026-10-07T09:00:00Z', 'weekly', '2026-10-07T10:00:00Z', days)?.toISOString(), '2026-10-14T09:00:00.000Z');
    assert.equal(next('2026-10-07T09:00:00Z', 'weekly', '2026-11-20T10:00:00Z', days)?.toISOString(), '2026-11-25T09:00:00.000Z');
  }
});

test('T4 weekly/custom selections honor only their chosen weekdays and reject malformed/empty custom rules', () => {
  for (const rule of ['weekly', 'custom'] as const) {
    assert.equal(next('2026-10-09T09:00:00Z', rule, '2026-10-09T10:00:00Z', [2, 4, 2])?.toISOString(), '2026-10-13T09:00:00.000Z');
    for (const invalid of [[7], [-1], [1.5], [0, 7], [NaN]]) assert.equal(next('2026-10-09T09:00:00Z', rule, '2026-10-09T10:00:00Z', invalid), null);
  }
  assert.equal(next('2026-10-09T09:00:00Z', 'custom', '2026-10-09T10:00:00Z', []), null);
  assert.equal(next('2026-10-09T09:00:00Z', 'custom', '2026-10-09T10:00:00Z'), null);
});

test('T4 monthly clamps short months, including leap years and year rollover', () => {
  const cases = [
    ['2026-01-31T09:00:00Z', '2026-02-28T09:00:00.000Z'],
    ['2024-01-31T09:00:00Z', '2024-02-29T09:00:00.000Z'],
    ['2026-03-31T09:00:00Z', '2026-04-30T09:00:00.000Z'],
    ['2026-12-31T09:00:00Z', '2027-01-31T09:00:00.000Z'],
  ];
  for (const [due, expected] of cases) assert.equal(next(due, 'monthly', due)?.toISOString(), expected);
  assert.equal(next('2020-01-31T09:00:00Z', 'monthly', '2026-04-01T10:00:00Z')?.toISOString(), '2026-04-30T09:00:00.000Z');
  assert.equal(next('2020-01-31T09:00:00Z', 'monthly', '2026-04-30T10:00:00Z')?.toISOString(), '2026-05-31T09:00:00.000Z');
});

test('T4 yearly clamps Feb 29 and selects the next valid year after a long overdue interval', () => {
  assert.equal(next('2024-02-29T09:00:00Z', 'yearly', '2024-02-29T09:00:00Z')?.toISOString(), '2025-02-28T09:00:00.000Z');
  assert.equal(next('2024-02-29T09:00:00Z', 'yearly', '2028-02-01T09:00:00Z')?.toISOString(), '2028-02-29T09:00:00.000Z');
  assert.equal(next('2024-02-29T09:00:00Z', 'yearly', '2030-08-01T09:00:00Z')?.toISOString(), '2031-02-28T09:00:00.000Z');
  assert.equal(next('2020-12-15T09:00:00Z', 'yearly', '2026-10-10T09:00:00Z')?.toISOString(), '2026-12-15T09:00:00.000Z');
});

test('T4 invalid dates, missing rules and unknown rules return no occurrence rather than an invalid Date', () => {
  assert.equal(next('invalid', 'daily', '2026-10-10T09:00:00Z'), null);
  assert.equal(next('2026-10-10T09:00:00Z', 'daily', 'invalid'), null);
  assert.equal(next('2026-10-10T09:00:00Z', null, '2026-10-10T09:00:00Z'), null);
  assert.equal(next('2026-10-10T09:00:00Z', 'unknown' as any, '2026-10-10T09:00:00Z'), null);
});

test('T4 local wall-clock recurrence survives DST and normalizes nonexistent/ambiguous times consistently', () => {
  process.env.TZ = 'America/New_York';
  try {
    const before = new Date('2026-03-07T09:00:00');
    const after = next(before.toISOString(), 'daily', before.toISOString())!;
    assert.equal(after.getHours(), 9);
    assert.equal(after.getTime() - before.getTime(), 23 * 3600000);
    const gap = next('2026-03-07T02:30:00', 'daily', '2026-03-07T02:30:00')!;
    assert.equal(gap.getTime(), new Date('2026-03-08T02:30:00').getTime());
    const overlap = next('2026-10-31T01:30:00', 'daily', '2026-10-31T01:30:00')!;
    assert.equal(overlap.toISOString(), '2026-11-01T05:30:00.000Z');
  } finally { process.env.TZ = 'UTC'; }
});

test('T4 actual completeReminder ignores snooze clock, clears occurrence state, preserves sound and persists its update', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T10:00:00Z') });
  try {
    const reminder = await db.createReminder({ title: 'T4 daily snoozed', due_at: '2026-10-10T09:12:34.500Z', recurrence: 'daily', alarm_sound: 'birdsong' });
    await db.updateReminder(reminder.id, { snoozed_until: '2026-10-12T15:40:00Z', fired_at: '2026-10-10T09:12:34.500Z' });
    await db.completeReminder(reminder.id);
    const updated = db.dbState().reminders.find(r => r.id === reminder.id)!;
    assert.equal(updated.due_at, '2026-10-11T09:12:34.500Z');
    assert.equal(updated.done, false);
    assert.equal(updated.snoozed_until, null);
    assert.equal(updated.fired_at, null);
    assert.equal(updated.alarm_sound, 'birdsong');
    const persisted = await idbGet<Reminder[]>(cacheKey(userId, 'reminders'));
    assert.equal(persisted?.find(r => r.id === reminder.id)?.due_at, updated.due_at);
    const outbox = await idbGet<any[]>('outbox');
    assert.equal(outbox?.filter(op => op.table === 'reminders' && op.ref === reminder.id && op.patch?.due_at).at(-1)?.patch.due_at, updated.due_at);
  } finally { t.mock.timers.reset(); }
});

test('T4 actual completeReminder rolls overdue weekly/monthly/yearly rules past now', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T10:00:00Z') });
  try {
    for (const [rule, due, expected] of [
      ['weekly', '2020-01-01T09:00:00Z', '2026-10-14T09:00:00.000Z'],
      ['monthly', '2020-01-31T09:00:00Z', '2026-10-31T09:00:00.000Z'],
      ['yearly', '2020-02-29T09:00:00Z', '2027-02-28T09:00:00.000Z'],
    ] as const) {
      const reminder = await db.createReminder({ title: 'T4 overdue ' + rule, due_at: due, recurrence: rule });
      await db.completeReminder(reminder.id);
      assert.equal(db.dbState().reminders.find(r => r.id === reminder.id)?.due_at, expected);
    }
  } finally { t.mock.timers.reset(); }
});

test('T4 actual completion rejects invalid repeating rules without silently completing them; one-time reminders still complete', async () => {
  const invalid = await db.createReminder({ title: 'T4 invalid custom', due_at: '2026-10-10T09:00:00Z', recurrence: 'custom' });
  await assert.rejects(db.completeReminder(invalid.id), /recurrence days/);
  assert.equal(db.dbState().reminders.find(r => r.id === invalid.id)?.done, false);
  const once = await db.createReminder({ title: 'T4 once' });
  await db.completeReminder(once.id);
  assert.equal(db.dbState().reminders.find(r => r.id === once.id)?.done, true);
});
