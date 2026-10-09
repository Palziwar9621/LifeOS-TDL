import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { planNativeAlarms } from '../src/lib/nativeAlarmPlan.ts';

const blank = () => ({ reminders: [], tasks: [], routine_tasks: [], routine_completions: [] });

test('T4 routine dates remain local in positive-offset zones, including final horizon day', () => {
  const before = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    const state: any = blank();
    state.routine_tasks = [{ id: 'r', title: 'Routine', time_of_day: '10:00', days: [0,1,2,3,4,5,6] }];
    const alarms = planNativeAlarms(state, new Date('2026-10-10T09:00').getTime(), () => false);
    assert.equal(alarms.length, 7);
    assert.equal(alarms[0].key, 'routine:r:2026-10-10');
    assert.equal(new Date(alarms[0].at).getHours(), 10);
    const later = planNativeAlarms(state, new Date('2026-10-10T11:00').getTime(), () => false);
    assert.equal(later.at(-1)?.key, 'routine:r:2026-10-17');
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test('T4 daily routines preserve local time over spring DST and extra dates override weekday', () => {
  const before = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const state: any = blank();
    state.routine_tasks = [{ id: 'r', title: 'Routine', time_of_day: '09:00', days: [0,1,2,3,4,5,6] },
      { id: 'extra', title: 'Extra', time_of_day: '11:00', weekday: 3, extra_date: '2026-03-08' }];
    const alarms = planNativeAlarms(state, new Date('2026-03-07T08:00').getTime(), () => false);
    const routine = alarms.filter(a => a.key.startsWith('routine:r:'));
    assert.equal(routine[1].at - routine[0].at, 23 * 3600000);
    assert.ok(routine.every(a => new Date(a.at).getHours() === 9));
    assert.ok(alarms.some(a => a.key === 'routine:extra:2026-03-08'));
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test('T4 task without explicit lead is scheduled, edits/cancel/completion/dismissal remove occurrences', () => {
  const state: any = blank();
  const now = new Date('2026-10-10T08:00').getTime();
  const task = { id: 't', title: 'Task', due_date: '2026-10-10', due_time: '09:00', remind_me: true };
  state.tasks = [task];
  let alarms = planNativeAlarms(state, now, () => false);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].at, new Date('2026-10-10T09:00').getTime());
  assert.equal(alarms[0].localAt, '2026-10-10T09:00');
  state.tasks = [{ ...task, due_time: '10:00', reminder_minutes: 15 }];
  alarms = planNativeAlarms(state, now, () => false);
  assert.equal(alarms[0].key, 'task:t:2026-10-10:10:00');
  assert.equal(new Date(alarms[0].at).getMinutes(), 45);
  for (const patch of [{ deleted: true }, { status: 'completed' }, { remind_me: false }]) {
    state.tasks = [{ ...task, ...patch }];
    assert.equal(planNativeAlarms(state, now, () => false).length, 0);
  }
  state.tasks = [task];
  assert.equal(planNativeAlarms(state, now, () => true).length, 0);
});

test('T4 one-time alarms beyond a week persist and overdue keys identify valid native snoozes', () => {
  const state: any = blank();
  const now = new Date('2026-10-10T08:00').getTime();
  state.tasks = [{ id: 'far', title: 'Next month', due_date: '2026-11-20', due_time: '09:00' },
    { id: 'snoozed', title: 'Past due', due_date: '2026-10-10', due_time: '07:00' }];
  assert.equal(planNativeAlarms(state, now, () => false).length, 1);
  assert.equal(planNativeAlarms(state, now, () => false, true).length, 2);
  state.tasks[1].status = 'completed';
  assert.equal(planNativeAlarms(state, now, () => false, true).length, 1);
});

function bridgeHarness(schedule: (payload: string) => unknown) {
  const state: any = { ...blank(), user_settings: { data: { alarm_sound: 'birdsong', alert_mode: 'alarm' } } };
  const listeners: (() => void)[] = [];
  const events: Record<string, () => void> = {};
  const exports: any = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/nativeAlarms.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, console, setTimeout, setInterval: () => 1,
    window: { LifeOSNative: { platform: 'electron', alarms: { scheduleAlarms: schedule } }, addEventListener: (event: string, cb: () => void) => { events[event] = cb; } },
    require: (name: string) => {
      if (name === './db') return { dbState: () => state, getSettings: () => state.user_settings?.data ?? {}, subscribeDb: (cb: () => void) => listeners.push(cb) };
      if (name === './dismissals') return { isKeyDismissed: () => false, dismissKey: () => {}, syncDismissals: async () => {} };
      if (name === './nativeAlarmPlan') return { planNativeAlarms };
      throw new Error(name);
    } });
  return { api: exports, state, listeners, events };
}

test('T4 bridge awaits real IPC receipts, retries failures, preserves sound and off mode', async () => {
  const sent: any[] = [];
  const h = bridgeHarness(async payload => { sent.push(JSON.parse(payload)); return { ok: sent.length > 1 }; });
  await h.api.syncNativeAlarms();
  await h.api.syncNativeAlarms();
  await h.api.syncNativeAlarms();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].sound, 'birdsong');
  assert.equal(sent[0].mode, 'alarm');
  assert.deepEqual(JSON.parse(h.api.nativeSyncStatus()), { ok: true });
  h.state.user_settings.data.alert_mode = 'off';
  await h.api.syncNativeAlarms();
  assert.equal(sent[2].mode, 'off');
  assert.deepEqual(sent[2].alarms, []);
});

test('T4 startup empty store cannot erase offline snapshot; DB edits sync immediately', async () => {
  const sent: any[] = [];
  const h = bridgeHarness(payload => { sent.push(JSON.parse(payload)); return JSON.stringify({ ok: true }); });
  const settings = h.state.user_settings;
  h.state.user_settings = null;
  await h.api.syncNativeAlarms();
  assert.equal(sent.length, 0);
  h.state.user_settings = settings;
  h.api.startNativeAlarmSync();
  await new Promise(resolve => setImmediate(resolve));
  h.state.user_settings.data.alarm_sound = 'none';
  h.listeners[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.at(-1).sound, 'none');
  const count = sent.length;
  h.events.focus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, count + 1);
});
