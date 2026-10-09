import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/lib/db.ts';
import { getClient } from '../src/lib/supabase.ts';
import { runAssistantTool } from '../src/lib/assistantTools.ts';
import { getAssistantSettings, saveAssistantSettings, extractWakeCommand, executeCommand, buildAppContext, startListening, stopListening, isListening, nativeTtsSpeak, duckMicForSpeech, VOICE_MODEL_LOAD_TIMEOUT_MS } from '../src/lib/voice.ts';

const storage = new Map<string, string>();
const win = new EventTarget() as any;
win.location = { hash: '' };
const context = { page: 'home', pageParams: {}, navigate: () => {} };
before(async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  storage.set('lifeos.guest', '1');
  // db.ts asks for a client before its guest guard. This inert config avoids
  // Vite-only import.meta.env in Node; guest mode prevents network use.
  storage.set('lifeos.supabase', JSON.stringify({ url: 'https://assistant-tests.invalid', anonKey: 'test-only-not-a-secret' }));
  await db.initStore('assistant-test-guest');
});
after(async () => { stopListening(); await db.resetStore(); });

test('launch stays idle and legacy always-listen settings do not imply wake consent', () => {
  assert.equal(isListening(), false);
  storage.set('lifeos.assistant', JSON.stringify({ enabled: true, listenContinuously: true }));
  assert.equal(getAssistantSettings().listenContinuously, false);
  const settings = getAssistantSettings();
  assert.equal(extractWakeCommand('hello stranger', settings), null);
  assert.equal(extractWakeCommand('hey lifeosaurus', settings), null);
  assert.equal(extractWakeCommand('hey lifeos, add task milk', settings), 'add task milk');
});
test('native readiness and permission failure reflect real microphone state and drop late transcripts', () => {
  let starts = 0, heard = 0;
  const states: string[] = [], errors: string[] = [];
  win.LifeOSSpeech = { startContinuous() { starts++; }, stopContinuous() {} };
  assert.equal(startListening(() => heard++, e => errors.push(e), state => states.push(state)), true);
  assert.deepEqual(states, ['starting']); assert.equal(starts, 1);
  win.__lifeosSpeech.onSpeechReady(); assert.equal(states.at(-1), 'listening');
  win.__lifeosSpeech.onSpeechError('9'); assert.equal(isListening(), false);
  win.__lifeosSpeech.onSpeechResult('add task late'); assert.equal(heard, 0);
  assert.equal(states.at(-1), 'stopped'); assert.match(errors[0], /permission denied/);
  delete win.LifeOSSpeech;
});

test('Vosk loading remains honest beyond 15 seconds and expires once at 90 seconds', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states: string[] = [], errors: string[] = [];
  win.LifeOSSpeech = { recognitionEngine: () => 'vosk-en-us-0.15', startContinuous() {}, stopContinuous() {} };
  try {
    startListening(() => {}, e => errors.push(e), state => states.push(state));
    win.__lifeosSpeech.onSpeechState('loading');
    t.mock.timers.tick(16_000);
    assert.equal(isListening(), true); assert.equal(states.at(-1), 'loading'); assert.equal(errors.length, 0);
    win.__lifeosSpeech.onSpeechState('loading'); // duplicates cannot extend forever
    t.mock.timers.tick(VOICE_MODEL_LOAD_TIMEOUT_MS - 16_000);
    assert.equal(isListening(), false); assert.equal(errors.length, 1); assert.match(errors[0], /model.*loading/);
    win.__lifeosSpeech.onSpeechReady(); assert.equal(states.at(-1), 'stopped');
  } finally { stopListening(); delete win.LifeOSSpeech; t.mock.timers.reset(); }
});
test('Vosk accepted-word event interrupts before final; cancelled TTS releases gating immediately', () => {
  const controller = new AbortController(); let heard = 0, endStatus = '';
  win.LifeOSSpeech = { startContinuous() {}, stopContinuous() {}, speak() {}, stopSpeak() {}, setMuted() {} };
  try {
    startListening(() => heard++, undefined, undefined, () => controller.abort());
    win.__lifeosSpeech.onSpeechState('loading');
    win.__lifeosSpeech.onSpeechBeginning(); assert.equal(controller.signal.aborted, false);
    win.__lifeosSpeech.onSpeechReady();
    duckMicForSpeech(); nativeTtsSpeak('I added your note.', status => { endStatus = status!; });
    win.__lifeosSpeech.onSpeakEnd('cancelled');
    assert.equal(endStatus, 'cancelled'); assert.equal(win.__lifeosMicMuted, false);
    win.__lifeosSpeech.onSpeechBeginning(); assert.equal(controller.signal.aborted, true); assert.equal(heard, 0);
    win.__lifeosSpeech.onSpeechPartial('wait instead'); assert.equal(heard, 1);
  } finally { stopListening(); delete win.LifeOSSpeech; }
});
test('native start failure never switches to a stock web recognizer', () => {
  let stockStarts = 0;
  win.LifeOSSpeech = { startContinuous() { throw new Error('engine failed'); }, stopContinuous() {} };
  win.SpeechRecognition = class { start() { stockStarts++; } };
  try { assert.equal(startListening(() => {}), false); assert.equal(stockStarts, 0); }
  finally { stopListening(); delete win.LifeOSSpeech; delete win.SpeechRecognition; }
});
test('project and goal milestone CRUD is scoped, reopenable and persisted locally', async () => {
  const project = await db.createProject({ name: 'Garden' });
  const goal = await db.createGoal({ title: 'Fitness' });
  await runAssistantTool({ name: 'add_milestone', args: { scope: 'project', name_match: 'Garden', title: 'First step', due_date: '2026-12-01' } }, context);
  await runAssistantTool({ name: 'add_milestone', args: { scope: 'goal', name_match: 'Fitness', title: 'First step' } }, context);
  await runAssistantTool({ name: 'complete_milestone', args: { scope: 'project', name_match: 'Garden', title_match: 'First step' } }, context);
  assert.equal(db.dbState().project_milestones.find(m => m.project_id === project.id)?.done, true);
  assert.equal(db.dbState().goal_milestones.find(m => m.goal_id === goal.id)?.done, false);
  await runAssistantTool({ name: 'update_milestone', args: { scope: 'project', name_match: 'Garden', title_match: 'First step', new_title: 'Dig', done: false, due_date: null } }, context);
  assert.match(await runAssistantTool({ name: 'query_milestones', args: { scope: 'project', name_match: 'Garden' } }, context), /Dig.*open/);
  await runAssistantTool({ name: 'delete_milestone', args: { scope: 'project', name_match: 'Garden', title_match: 'Dig' } }, context);
  assert.equal(db.dbState().project_milestones.filter(m => m.project_id === project.id).length, 0);
  assert.equal(db.dbState().goal_milestones.filter(m => m.goal_id === goal.id).length, 1);
});
test('notes update real fields but queries/context never expose private bodies', async () => {
  await runAssistantTool({ name: 'add_note', args: { title: 'Travel', content: 'SECRET-CONTENT' } }, context);
  await runAssistantTool({ name: 'update_note', args: { title_match: 'Travel', new_title: 'Trip', content: 'NEW-SECRET', pinned: true } }, context);
  const note = db.dbState().notes.find(n => n.title === 'Trip')!;
  assert.equal(note.content, 'NEW-SECRET'); assert.equal(note.pinned, true);
  const reply = await runAssistantTool({ name: 'query_notes', args: { title_contains: 'Trip' } }, context);
  assert.match(reply, /Trip/); assert.doesNotMatch(reply, /SECRET/);
  assert.doesNotMatch(JSON.stringify(buildAppContext('home', { taskId: 'SECRET-ID' })), /SECRET|Trip/);
  await db.createNote({ title: 'Trip' });
  await assert.rejects(runAssistantTool({ name: 'delete_note', args: { title_match: 'Trip' } }, context), /2 matches/);
  assert.equal(db.dbState().notes.filter(n => n.title === 'Trip' && !n.deleted).length, 2);
});
test('offline commands use validated executor; cancellation before planning creates nothing', async () => {
  saveAssistantSettings({ ...getAssistantSettings(), useAI: false });
  const result = await executeCommand('add task call Sam tomorrow at 7 PM', context);
  assert.equal(result.ok, true);
  assert.match(db.dbState().tasks.find(t => /call sam/i.test(t.title))!.due_time!, /^19:00/);
  const controller = new AbortController(); controller.abort();
  await executeCommand('add task should never exist', context, [], controller.signal);
  assert.equal(db.dbState().tasks.some(t => t.title === 'should never exist'), false);
});
test('weekday recurrence maps to Monday–Friday, not the current day', async () => {
  await db.createTask({ title: 'Exercise', due_date: '2026-10-10' });
  await runAssistantTool({ name: 'set_recurrence', args: { title_match: 'Exercise', rule: 'weekdays' } }, context);
  assert.deepEqual(db.dbState().tasks.find(t => t.title === 'Exercise')!.recurrence_days, [1,2,3,4,5]);
});

test('bounded CRUD updates and deletes every advertised small-entity adapter', async () => {
  const cases = [
    { kind: 'idea', table: 'ideas', create: { title: 'CRUD idea', description: 'before' }, update: { description: 'after', priority: 'high' }, field: 'description', value: 'after' },
    { kind: 'remember', table: 'remember_items', create: { title: 'CRUD remember', content: 'before' }, update: { content: 'after', favorite: true }, field: 'content', value: 'after' },
    { kind: 'reminder', table: 'reminders', create: { title: 'CRUD reminder', due_at: '2026-12-01T09:00:00Z' }, update: { due_at: '2026-12-02T10:00:00Z', done: true }, field: 'done', value: true },
    { kind: 'routine', table: 'routine_tasks', create: { title: 'CRUD routine', days: [1,3] }, update: { extra_date: '2026-12-01' }, field: 'days', value: null },
    { kind: 'goal', table: 'goals', create: { title: 'CRUD goal' }, update: { progress: 50, deadline: '2026-12-01' }, field: 'progress', value: 50 },
    { kind: 'project', table: 'projects', create: { name: 'CRUD project' }, update: { status: 'on_hold', target_date: '2026-12-01' }, field: 'status', value: 'on_hold' },
  ];
  for (const c of cases) {
    const title = 'CRUD ' + c.kind;
    const selector = c.kind === 'project' ? { name_match: title } : { title_match: title };
    await runAssistantTool({ name: `${['goal','project'].includes(c.kind) ? 'create' : 'add'}_${c.kind}`, args: c.create }, context);
    await runAssistantTool({ name: `update_${c.kind}`, args: { ...selector, ...c.update } }, context);
    const row = (db.dbState() as any)[c.table].find((r: any) => (r.title ?? r.name) === title);
    assert.equal(row[c.field], c.value, c.kind);
    await runAssistantTool({ name: `delete_${c.kind}`, args: selector }, context);
    assert.equal((db.dbState() as any)[c.table].some((r: any) => r.id === row.id && !r.deleted && !r.archived), false, c.kind);
  }
});

test('model success prose cannot replace missing-target execution results', async (t) => {
  t.mock.method(getClient()!.auth, 'getSession', async () => ({ data: { session: { access_token: 'fixture-only-not-a-secret', user: { id: 'authenticated-test-user' }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }));
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ reply: 'Done, deleted your task!', calls: [{ name: 'delete_task', args: { title_match: 'Nonexistent task' } }] }), { headers: { 'Content-Type': 'application/json' } });
  saveAssistantSettings({ ...getAssistantSettings(), useAI: true });
  try {
    const result = await executeCommand('delete task Nonexistent task', context);
    assert.equal(result.ok, false); assert.match(result.message, /couldn’t find/);
    assert.doesNotMatch(result.message, /Done, deleted/);
  } finally { globalThis.fetch = original; }
});

test('barge-in aborts pending assistant fetch and never falls back to an offline write', { timeout: 5000 }, async (t) => {
  t.mock.method(getClient()!.auth, 'getSession', async () => ({ data: { session: { access_token: 'fixture-only-not-a-secret', user: { id: 'authenticated-test-user' }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }));
  const original = globalThis.fetch;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let aborted = false;
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    started();
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
  });
  saveAssistantSettings({ ...getAssistantSettings(), useAI: true });
  const controller = new AbortController();
  try {
    const pending = executeCommand('add task Never commit after fetch abort', context, [], controller.signal);
    await ready;
    win.LifeOSSpeech = { startContinuous() {}, stopContinuous() {} };
    startListening(() => {}, undefined, undefined, () => controller.abort());
    win.__lifeosSpeech.onSpeechReady(); win.__lifeosSpeech.onSpeechBeginning();
    assert.equal((await pending).cancelled, true); assert.equal(aborted, true);
    assert.equal(db.dbState().tasks.some(t => /Never commit/i.test(t.title)), false);
  } finally { stopListening(); delete win.LifeOSSpeech; globalThis.fetch = original; }
});

test('subtask CRUD is parent-scoped and rejects duplicate matches', async () => {
  const first = await db.createTask({ title: 'Subtask parent A' });
  const second = await db.createTask({ title: 'Subtask parent B' });
  for (const task_match of [first.title, second.title]) await runAssistantTool({ name: 'add_subtask', args: { task_match, title: 'Research' } }, context);
  await runAssistantTool({ name: 'update_subtask', args: { task_match: first.title, title_match: 'Research', done: true, new_title: 'Sources' } }, context);
  assert.equal(db.dbState().subtasks.find(t => t.task_id === first.id)?.done, true);
  assert.equal(db.dbState().subtasks.find(t => t.task_id === second.id)?.done, false);
  assert.match(await runAssistantTool({ name: 'query_subtasks', args: { task_match: first.title } }, context), /Sources.*done/);
  await runAssistantTool({ name: 'delete_subtask', args: { task_match: first.title, title_match: 'Sources' } }, context);
  await db.createSubtask(second.id, 'Research');
  await assert.rejects(runAssistantTool({ name: 'delete_subtask', args: { task_match: second.title, title_match: 'Research' } }, context), /2 matches/);
});
test('tag/category CRUD and task relationships resolve names before writes, preserving other tags', async () => {
  const task = await db.createTask({ title: 'Organize fixtures' });
  await runAssistantTool({ name: 'create_tag', args: { name: '#Fixture', color: '#aabbcc' } }, context);
  await runAssistantTool({ name: 'create_tag', args: { name: 'Other fixture' } }, context);
  await runAssistantTool({ name: 'create_category', args: { name: 'Fixture category' } }, context);
  await runAssistantTool({ name: 'update_tag', args: { name_match: 'fixture', new_name: 'fixture renamed', color: '#112233' } }, context);
  await runAssistantTool({ name: 'update_category', args: { name_match: 'Fixture category', new_name: 'Fixture area', color: '#223344' } }, context);
  assert.match(await runAssistantTool({ name: 'query_tags', args: { name_contains: 'renamed' } }, context), /fixture renamed/);
  assert.match(await runAssistantTool({ name: 'query_categories', args: { name_contains: 'Fixture' } }, context), /Fixture area/);
  for (const tag_match of ['fixture renamed', 'Other fixture', 'fixture renamed']) await runAssistantTool({ name: 'set_task_tag', args: { title_match: task.title, tag_match, attached: true } }, context);
  assert.equal(db.dbState().task_tags.filter(t => t.task_id === task.id).length, 2);
  await runAssistantTool({ name: 'set_task_relationships', args: { title_match: task.title, project_match: 'Garden', goal_match: 'Fitness', category_match: 'Fixture area' } }, context);
  const before = db.dbState().tasks.find(t => t.id === task.id)!;
  await assert.rejects(runAssistantTool({ name: 'set_task_relationships', args: { title_match: task.title, project_match: null, goal_match: 'Missing target' } }, context), /couldn’t find/);
  assert.equal(db.dbState().tasks.find(t => t.id === task.id)!.project_id, before.project_id);
  await assert.rejects(runAssistantTool({ name: 'delete_category', args: { name_match: 'Fixture area' } }, context), /still linked/);
  assert.match(await runAssistantTool({ name: 'query_task_relationships', args: { title_match: task.title } }, context), /Garden.*Fitness.*Fixture area.*fixture renamed/);
  await runAssistantTool({ name: 'set_task_tag', args: { title_match: task.title, tag_match: 'fixture renamed', attached: false } }, context);
  assert.equal(db.dbState().task_tags.filter(t => t.task_id === task.id).length, 1);
  await runAssistantTool({ name: 'delete_tag', args: { name_match: 'Other fixture' } }, context);
  assert.equal(db.dbState().task_tags.filter(t => t.task_id === task.id).length, 0);
  await runAssistantTool({ name: 'set_task_relationships', args: { title_match: task.title, category_match: null, project_match: null, goal_match: null } }, context);
  await runAssistantTool({ name: 'delete_category', args: { name_match: 'Fixture area' } }, context);
  assert.equal(db.dbState().categories.some(c => c.name === 'Fixture area'), false);
});
test('planner block CRUD validates merged times and disambiguates by existing weekday', async () => {
  for (const weekday of [1,3]) await runAssistantTool({ name: 'add_schedule_block', args: { title: 'Study block', weekday, start_time: '09:00', end_time: '10:00', linked_task_match: 'Organize fixtures' } }, context);
  await assert.rejects(runAssistantTool({ name: 'delete_schedule_block', args: { title_match: 'Study block' } }, context), /2 matches/);
  await assert.rejects(runAssistantTool({ name: 'update_schedule_block', args: { title_match: 'Study block', match_weekday: 1, start_time: '11:00' } }, context), /end after/);
  await runAssistantTool({ name: 'update_schedule_block', args: { title_match: 'Study block', match_weekday: 1, start_time: '08:00', new_title: 'Early study', linked_task_match: null } }, context);
  assert.match(await runAssistantTool({ name: 'query_schedule_blocks', args: { weekday: 1 } }, context), /Early study.*08:00/);
  const saved = db.dbState().schedule_blocks.find(b => b.title === 'Early study')!;
  assert.equal(saved.linked_task_id, null); assert.equal(saved.end_time.slice(0,5), '10:00');
  await runAssistantTool({ name: 'delete_schedule_block', args: { title_match: 'Study block', match_weekday: 3 } }, context);
  assert.equal(db.dbState().schedule_blocks.some(b => b.title === 'Study block' && !b.deleted), false);
});
test('reminder snooze/reschedule and recurring completion use real fields', async () => {
  const reminder = await db.createReminder({ title: 'Snooze fixture', due_at: '2026-12-01T09:00:00Z', recurrence: 'daily' });
  const now = Date.now();
  await runAssistantTool({ name: 'snooze_reminder', args: { title_match: reminder.title, minutes: 10 } }, context);
  const snoozed = db.dbState().reminders.find(r => r.id === reminder.id)!;
  assert.ok(Date.parse(snoozed.snoozed_until!) >= now + 600_000); assert.equal(snoozed.fired_at, null);
  await runAssistantTool({ name: 'complete_reminder', args: { title_match: reminder.title } }, context);
  const advanced = db.dbState().reminders.find(r => r.id === reminder.id)!;
  assert.ok(Date.parse(advanced.due_at) > Math.max(now, Date.parse(reminder.due_at)));
  assert.equal(advanced.done, false);
  assert.equal(advanced.snoozed_until, null);
  await runAssistantTool({ name: 'update_reminder', args: { title_match: reminder.title, due_at: '2026-12-02T12:00:00Z', recurrence: null } }, context);
  const next = db.dbState().reminders.find(r => r.id === reminder.id)!;
  assert.equal(next.snoozed_until, null); assert.equal(next.fired_at, null);
  await runAssistantTool({ name: 'complete_reminder', args: { title_match: reminder.title } }, context);
  assert.equal(db.dbState().reminders.find(r => r.id === reminder.id)!.done, true);
});
