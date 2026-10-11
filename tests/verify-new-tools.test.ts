import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initStore, dbState, createTask, resetStore } from '../src/lib/db.ts';
import { runAssistantTool } from '../src/lib/assistantTools.ts';
import { parseCommand } from '../src/lib/assistant.ts';
import { validateToolCall } from '../supabase/functions/assistant/contract.ts';

const storage = new Map<string, string>();
const win: any = { location: { hash: '' }, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} };
const context = { page: 'home' as const, pageParams: {}, navigate: () => {} };

test('reschedule_task and query_stats run through the real executor', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  storage.set('lifeos.guest', '1');
  storage.set('lifeos.supabase', JSON.stringify({ url: 'https://assistant-tests.invalid', anonKey: 'test-only-not-a-secret' }));
  await initStore('verify-tools-new');
  try {
    await createTask({ title: 'Laundry', due_date: '2026-09-01', priority: 'medium', status: 'inbox' });
    const r = await runAssistantTool({ name: 'reschedule_task', args: { title_match: 'Laundry', when: 'tomorrow' } }, context);
    assert.match(r, /Moved .*Laundry.*tomorrow/);
    assert.ok(dbState().tasks[0].due_date >= '2026-10-12');
    const again = await runAssistantTool({ name: 'reschedule_task', args: { title_match: 'Laundry', when: 'tomorrow' } }, context);
    assert.match(again, /already scheduled/);
    const overview = await runAssistantTool({ name: 'query_stats', args: { scope: 'overview' } }, context);
    assert.match(overview, /Overview/);
    const day = await runAssistantTool({ name: 'query_stats', args: { scope: 'day' } }, context);
    assert.match(day, /Today:/);
  } finally { await resetStore({ wipeCache: true }); }
});

test('new-tool schemas and offline parser rules hold', () => {
  assert.equal(validateToolCall({ name: 'reschedule_task', args: { title_match: 'Laundry', when: 'tomorrow' } }).args.when, 'tomorrow');
  assert.throws(() => validateToolCall({ name: 'reschedule_task', args: { title_match: 'X', when: 'specific' } }), undefined);
  assert.throws(() => validateToolCall({ name: 'query_stats', args: { scope: 'year' } }), undefined);
  assert.equal(validateToolCall({ name: 'navigate', args: { page: 'tasks', view: 'overdue' } }).args.view, 'overdue');
  assert.throws(() => validateToolCall({ name: 'navigate', args: { page: 'home', view: 'overdue' } }), undefined);
  assert.equal(parseCommand('how am I doing').kind, 'summarize_stats');
});
