// Regression tests for the complete_routine executor branch (Productivity
// daily checklist) and for the turn-context titles that let the model target
// existing records on the first try.
// The real db module needs a browser (window, import.meta.env), so it is
// mocked with just the two functions the executor branch touches. If the mock
// were silently ignored, dbState() would return no routine and toggleRoutine
// would throw — so a broken mock fails loudly, never passes.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const tables = ['profiles', 'categories', 'tags', 'projects', 'project_milestones', 'goals', 'goal_milestones', 'tasks', 'subtasks', 'task_tags', 'notes', 'ideas', 'remember_items', 'schedule_blocks', 'reminders', 'focus_sessions', 'routine_tasks', 'routine_completions'];
const state: Record<string, any> = Object.fromEntries(tables.map(t => [t, []]));
state.user_settings = null;
state.routine_tasks = [{ id: 'r-gym', title: 'Gym', archived: false, deleted: false, status: null }];

let toggles: { taskId: string; date: string }[] = [];
mock.module('../src/lib/db.ts', {
  exports: {
    dbState: () => state,
    toggleRoutineCompletion: async (taskId: string, date: string) => {
      toggles.push({ taskId, date });
      const existing = state.routine_completions.find((c: any) => c.task_id === taskId && c.done_date === date);
      if (existing) state.routine_completions = state.routine_completions.filter((c: any) => c.id !== existing.id);
      else state.routine_completions.push({ id: `c-${toggles.length}`, task_id: taskId, done_date: date });
    },
  },
});

const { runAssistantTool } = await import('../src/lib/assistantTools.ts');
const { todayStr } = await import('../src/lib/dates.ts');
const ctx = { navigate: () => {} };

test('complete_routine ticks a routine for today using an exact or unique partial match', async () => {
  const reply = await runAssistantTool({ name: 'complete_routine', args: { title_match: 'gym' } }, ctx);
  assert.match(reply, /Ticked “Gym”/);
  assert.deepEqual(state.routine_completions, [{ id: 'c-1', task_id: 'r-gym', done_date: todayStr() }]);
});

test('re-ticking the same routine on the same day is idempotent (no second completion)', async () => {
  const reply = await runAssistantTool({ name: 'complete_routine', args: { title_match: 'Gym' } }, ctx);
  assert.match(reply, /Ticked “Gym”/);
  assert.equal(state.routine_completions.length, 1);
});

test('done=false unticks the day and removes the completion row', async () => {
  const reply = await runAssistantTool({ name: 'complete_routine', args: { title_match: 'gym', done: false } }, ctx);
  assert.match(reply, /Unticked “Gym”/);
  assert.equal(state.routine_completions.length, 0);
});

test('an explicit date ticks that day, not today', async () => {
  await runAssistantTool({ name: 'complete_routine', args: { title_match: 'gym', date: '2026-10-09' } }, ctx);
  assert.deepEqual(state.routine_completions, [{ id: 'c-3', task_id: 'r-gym', done_date: '2026-10-09' }]);
});

test('no matching routine fails with the asking-again error, never a silent success', async () => {
  await assert.rejects(() => runAssistantTool({ name: 'complete_routine', args: { title_match: 'nonexistent routine' } }, ctx), /couldn’t find|Which/);
});
