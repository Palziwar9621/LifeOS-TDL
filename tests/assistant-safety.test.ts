import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePlan, matchOne, stopIntent } from '../src/lib/assistantSafety.ts';
import { parseCommand, matchesWakeWord, stripWakeWord } from '../src/lib/assistant.ts';
import { TOOLS, validateToolCall } from '../supabase/functions/assistant/contract.ts';

test('natural stop intents are distinct from data commands', () => {
  for (const phrase of ['stop', 'Please stop.', 'cancel that', 'never mind', 'hold on']) assert.equal(stopIntent(phrase), 'interrupt', phrase);
  for (const phrase of ["I'm done", "that's enough for now", 'stop listening', 'turn off the assistant', 'be quiet', 'goodbye']) assert.equal(stopIntent(phrase), 'end', phrase);
  for (const phrase of ['stop laundry repeating', 'delete task Stop smoking', 'add note goodbye party', 'cancel task dentist']) assert.equal(stopIntent(phrase), null, phrase);
  assert.equal(parseCommand('please stop listening').kind, 'stop');
});
test('wake helpers require a complete leading phrase, not a word fragment', () => {
  assert.equal(matchesWakeWord('hey lifeosaurus', 'hey lifeos'), false);
  assert.equal(matchesWakeWord('someone said hey lifeos', 'hey lifeos'), false);
  assert.equal(matchesWakeWord('anything', ''), false);
  assert.equal(stripWakeWord('hey lifeos, open calendar', 'hey lifeos'), 'open calendar');
});
test('offline fallback never extracts destructive commands out of negations or examples', () => {
  for (const phrase of ["don't delete task dentist", 'how do I delete task dentist', 'delete all tasks', 'delete project garden', 'delete task garden and note shopping']) assert.equal(parseCommand(phrase).kind, 'unknown', phrase);
  assert.deepEqual(parseCommand('please delete note grocery list'), { kind: 'delete_note', title_match: 'grocery list' });
  const reminder = parseCommand('remind me to call Sam tomorrow');
  assert.equal(reminder.kind, 'add_reminder');
  assert.equal((reminder as any).due_at, undefined, 'do not invent an evening reminder');
});
test('duplicate matching requires a unique exact or unique one-way partial match', () => {
  const rows = [{ title: 'Call Sam' }, { title: 'Call Sam Smith' }];
  assert.equal(matchOne(rows, 'call sam', r => r.title), rows[0]);
  assert.throws(() => matchOne(rows, 'call', r => r.title), /2 matches/);
  assert.throws(() => matchOne([{ title: 'Dentist' }, { title: 'Dentist' }], 'Dentist', r => r.title), /2 matches/);
  assert.throws(() => matchOne(rows, '', r => r.title), /Which/);
  assert.throws(() => matchOne(rows, 'Call Sam tomorrow', r => r.title), /couldn’t find/);
});
test('tool schemas reject unknown controls, unknown patches, malformed times and unsupported goal dates', () => {
  const invalid = [
    { name: 'update_settings', args: { theme: 'dark' } },
    { name: 'update_note', args: { title_match: 'Note', user_id: 'other' } },
    { name: 'add_task', args: { title: ' ', due_time: '09:00' } },
    { name: 'add_task', args: { title: 'Dentist', due_date: '2026-02-30' } },
    { name: 'add_task', args: { title: 'Dentist', due_time: '25:00' } },
    { name: 'add_reminder', args: { title: 'Dentist', due_at: '2026-02-30T12:00:00Z' } },
    { name: 'add_routine', args: { title: 'Gym', days: [1,1] } },
    { name: 'add_routine', args: { title: 'Gym' } },
    { name: 'update_task', args: { title_match: 'Dentist' } },
    { name: 'add_milestone', args: { scope: 'goal', name_match: 'Fitness', title: 'First run', due_date: '2026-10-10' } },
    { name: 'update_subtask', args: { task_match: 'Parent', title_match: 'Child' } },
    { name: 'set_task_relationships', args: { title_match: 'Task', project_id: 'untrusted-id' } },
    { name: 'set_task_relationships', args: { title_match: 'Task' } },
    { name: 'create_tag', args: { name: '#' } },
    { name: 'create_category', args: { name: 'Category', color: 'javascript:alert(1)' } },
    { name: 'add_schedule_block', args: { title: 'Night', weekday: 1, start_time: '23:00', end_time: '01:00' } },
    { name: 'update_schedule_block', args: { title_match: 'Block', match_weekday: 1 } },
    { name: 'snooze_reminder', args: { title_match: 'Reminder', minutes: -10 } },
  ];
  for (const call of invalid) assert.throws(() => validateToolCall(call), undefined, call.name);
  assert.equal(validateToolCall({ name: 'update_milestone', args: { scope: 'project', name_match: 'Garden', title_match: 'Dig', done: false, due_date: null } }).args.done, false);
  const names = TOOLS.map(t => t.function.name);
  assert.equal(new Set(names).size, names.length);
  const reminderSchema = TOOLS.find(t => t.function.name === 'update_reminder')!.function.parameters.properties.recurrence;
  assert.ok((reminderSchema.enum as unknown[]).includes(null), 'model schema permits clearing recurrence');
});
test('cancel before execution makes no write; invalid later tool makes no partial plan', async () => {
  let writes = 0;
  const run = async () => { writes++; return 'Added task.'; };
  const controller = new AbortController(); controller.abort();
  const call = { name: 'add_task', args: { title: 'One' } };
  assert.equal((await executePlan([call], run, controller.signal)).cancelled, true);
  const invalid = await executePlan([call, { name: 'arbitrary_sql', args: {} }], run);
  assert.equal(invalid.ok, false); assert.equal(writes, 0);
});
test('barge-in keeps an entered write receipt and blocks all later writes', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  const running = executePlan([{ name: 'add_note', args: { title: 'One' } }, { name: 'add_note', args: { title: 'Two' } }], async () => { writes++; await gate; return 'Added note One.'; }, controller.signal);
  controller.abort(); release();
  const result = await running;
  assert.equal(writes, 1); assert.equal(result.cancelled, true);
  assert.deepEqual(result.results, ['Added note One.']);
  assert.doesNotMatch(result.message, /cancelled|undone/i);
});
test('failed tool halts dependent writes and never uses a generated success reply', async () => {
  let runs = 0;
  const result = await executePlan([{ name: 'delete_task', args: { title_match: 'Dentist' } }, { name: 'add_task', args: { title: 'Follow-up' } }], async () => { runs++; throw new Error('Two matching tasks; which one?'); });
  assert.equal(runs, 1); assert.equal(result.ok, false);
  assert.equal(result.message, 'Two matching tasks; which one?');
});
