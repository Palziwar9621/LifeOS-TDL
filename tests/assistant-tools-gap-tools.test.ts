// Executor tests for the gap tools added to the contract: duplicate_task,
// search_all, summarize_week, reset_tutorial, plus the new field support
// (task/note/idea archive, note folder/tags/links, reminder→task link,
// routine color and alarm sound).
// The real db module needs a browser, so it is mocked with just what the
// executor branches touch. A broken mock fails loudly, never passes.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const state: Record<string, any> = {
  profiles: [], categories: [], tags: [], projects: [], project_milestones: [], goals: [], goal_milestones: [],
  tasks: [
    { id: 't1', title: 'Laundry', notes: 'warm', status: 'planned', archived: false, deleted: false, due_date: '2026-10-12', priority: 'medium' },
    { id: 't2', title: 'Old draft', status: 'planned', archived: true, deleted: false, due_date: null },
  ],
  subtasks: [], task_tags: [],
  notes: [{ id: 'n1', title: 'Pancakes', content: 'flour, milk', folder: null, tags: [], archived: false, deleted: false, linked_task_id: null, linked_project_id: null, linked_goal_id: null }],
  ideas: [], remember_items: [], schedule_blocks: [],
  reminders: [{ id: 'rm1', title: 'Dentist', due_at: '2026-10-12T09:00:00Z', done: false, deleted: false, task_id: null }],
  routine_tasks: [{ id: 'r1', title: 'Gym', archived: false, deleted: false }],
  routine_completions: [], focus_sessions: [], user_settings: null,
};

mock.module('../src/lib/db.ts', {
  exports: {
    dbState: () => state,
    currentUserId: () => 'u1',
    duplicateTask: async (id: string) => {
      const t = state.tasks.find((x: any) => x.id === id);
      if (!t) return null;
      const copy = { ...t, id: `copy-${state.tasks.length}`, title: `${t.title} (copy)` };
      state.tasks.push(copy);
      return copy;
    },
    updateTask: async (id: string, patch: any) => { Object.assign(state.tasks.find((x: any) => x.id === id), patch); },
    updateNote: async (id: string, patch: any) => { Object.assign(state.notes.find((x: any) => x.id === id), patch); },
    updateReminder: async (id: string, patch: any) => { Object.assign(state.reminders.find((x: any) => x.id === id), patch); },
    updateRoutineTask: async (id: string, patch: any) => { Object.assign(state.routine_tasks.find((x: any) => x.id === id), patch); },
  },
});

const { runAssistantTool } = await import('../src/lib/assistantTools.ts');
const ctx = { navigate: () => {} };

test('duplicate_task copies the matched task', async () => {
  const reply = await runAssistantTool({ name: 'duplicate_task', args: { title_match: 'laundry' } }, ctx);
  assert.match(reply, /Duplicated “Laundry”/);
  assert.equal(state.tasks.length, 3);
  assert.equal(state.tasks[2].notes, 'warm');
});

test('search_all finds matches across kinds and reports nothing found otherwise', async () => {
  const reply = await runAssistantTool({ name: 'search_all', args: { query: 'pancakes' } }, ctx);
  assert.match(reply, /1 match for “pancakes”: 1 notes \(Pancakes\)/);
  const none = await runAssistantTool({ name: 'search_all', args: { query: 'zzz-not-there' } }, ctx);
  assert.match(none, /Nothing found/);
});

test('archived task is reachable again with archived=false (unarchive)', async () => {
  const reply = await runAssistantTool({ name: 'update_task', args: { title_match: 'Old draft', archived: false } }, ctx);
  assert.match(reply, /Updated task/);
  assert.equal(state.tasks.find((t: any) => t.id === 't2').archived, false);
});

test('update_note resolves folder, tags and a linked task by name', async () => {
  await runAssistantTool({ name: 'update_note', args: { title_match: 'Pancakes', folder: 'Recipes', tags: ['breakfast', 'fast'], linked_task_match: 'Laundry' } }, ctx);
  const note = state.notes[0];
  assert.equal(note.folder, 'Recipes');
  assert.deepEqual(note.tags, ['breakfast', 'fast']);
  assert.equal(note.linked_task_id, 't1');
  assert.equal('linked_task_match' in note, false);
});

test('update_reminder links a reminder to a task by name', async () => {
  await runAssistantTool({ name: 'update_reminder', args: { title_match: 'Dentist', task_match: 'Laundry' } }, ctx);
  assert.equal(state.reminders[0].task_id, 't1');
  assert.equal('task_match' in state.reminders[0], false);
});

test('update_routine sets color and alarm sound', async () => {
  await runAssistantTool({ name: 'update_routine', args: { title_match: 'Gym', color: '#ff0055', alarm_sound: 'chime' } }, ctx);
  assert.equal(state.routine_tasks[0].color, '#ff0055');
  assert.equal(state.routine_tasks[0].alarm_sound, 'chime');
});

test('reset_tutorial clears stored progress for the signed-in user', async () => {
  const { saveTutorialProgress, readTutorialProgress } = await import('../src/app/tutorialState.ts');
  saveTutorialProgress('u1', { status: 'completed', step: 14 });
  const reply = await runAssistantTool({ name: 'reset_tutorial', args: {} }, ctx);
  assert.match(reply, /Tutorial reset/);
  assert.equal(readTutorialProgress('u1', 20), null);
});

test('summarize_week answers without crashing on an empty week', async () => {
  const reply = await runAssistantTool({ name: 'summarize_week', args: {} }, ctx);
  assert.match(reply, /Last 7 days/);
});
