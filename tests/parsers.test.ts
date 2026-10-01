// Parser/date/recurrence regression tests (offline behaviour the user relies on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/lib/quickadd.ts';
import { addDays, diffDays, startOfWeek, isOverdue } from '../src/lib/dates.ts';
import { nextOccurrence, recurrenceSummary } from '../src/lib/recurrence.ts';

test('smart add parses date, time, priority and tags', () => {
  const p = parseQuickAdd('Finish Laplace assignment tomorrow at 7 PM !high #exam', '2026-10-01');
  assert.equal(p.due_date, '2026-10-02');
  assert.equal(p.due_time, '19:00:00');
  assert.equal(p.priority, 'high');
  assert.deepEqual(p.tags, ['exam']);
  assert.equal(p.title, 'Finish Laplace assignment');
});

test('smart add parses multi-weekday recurrence', () => {
  const p = parseQuickAdd('Gym every mon,wed,fri', '2026-10-01');
  assert.equal(p.recurrence, 'custom');
  assert.deepEqual(p.recurrence_days, [1, 3, 5]);
  const p2 = parseQuickAdd('Gym every mon and wed', '2026-10-01');
  assert.deepEqual(p2.recurrence_days, [1, 3]);
});

test('smart add parses reminder and duration hints', () => {
  const p = parseQuickAdd('Call mom @remind15 ~45m', '2026-10-01');
  assert.equal(p.reminder_minutes, 15);
  assert.equal(p.estimated_minutes, 45);
});

test('date math crosses month and DST boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-10-05', '2026-10-01'), 4);
  assert.equal(startOfWeek('2026-10-01'), '2026-09-28'); // Thursday → Monday
});

test('overdue ignores completed tasks and future dates', () => {
  assert.equal(isOverdue({ due_date: '2000-01-01', status: 'planned' }), true);
  assert.equal(isOverdue({ due_date: '2000-01-01', status: 'completed', completed_at: '2000-01-01T00:00:00Z' }), false);
  assert.equal(isOverdue({ due_date: '2999-01-01', status: 'planned' }), false);
  assert.equal(isOverdue({ due_date: null }), false);
});

test('recurrence: next occurrence on/after `from` (documented semantics)', () => {
  assert.equal(nextOccurrence({ recurrence: 'daily', recurrence_days: null, recurrence_monthday: null }, '2026-10-01'), '2026-10-01');
  assert.equal(
    nextOccurrence({ recurrence: 'custom', recurrence_days: [1, 3, 5], recurrence_monthday: null }, '2026-10-01'),
    '2026-10-02' // Friday after Thursday
  );
  assert.equal(
    nextOccurrence({ recurrence: 'custom', recurrence_days: [1, 3, 5], recurrence_monthday: null }, '2026-10-02'),
    '2026-10-02' // Friday itself counts
  );
  assert.equal(recurrenceSummary({ recurrence: 'custom', recurrence_days: [1, 3, 5], recurrence_monthday: null }), 'Every Mon, Wed, Fri');
});
