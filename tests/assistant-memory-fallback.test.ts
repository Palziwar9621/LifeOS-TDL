import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_MEMORY_MAX_CHARS,
  ASSISTANT_MEMORY_MAX_ENTRIES,
  compactAssistantHistory,
  loadAssistantMemory,
  saveAssistantMemory,
} from '../src/lib/assistantMemory.ts';
import { parseCommand } from '../src/lib/assistant.ts';
import { ASSISTANT_ERRORS } from '../src/lib/assistantError.ts';

const storage = new Map<string, string>();
const previousStorage = globalThis.localStorage;

before(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });
});

after(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
});

test('assistant memory is bounded, account-scoped, and omits private note bodies', () => {
  const long = Array.from({ length: ASSISTANT_MEMORY_MAX_ENTRIES + 4 }, (_, i) => ({
    role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
    content: i === 0 ? 'add note travel about passport number 12345' : `turn ${i} ${'x'.repeat(400)}`,
  }));
  const saved = saveAssistantMemory(long, 'account-a');
  assert.ok(saved.length <= ASSISTANT_MEMORY_MAX_ENTRIES);
  assert.ok(saved.reduce((n, item) => n + item.content.length, 0) <= ASSISTANT_MEMORY_MAX_CHARS);
  assert.doesNotMatch(JSON.stringify(loadAssistantMemory('account-a')), /passport number 12345/);
  assert.deepEqual(loadAssistantMemory('account-b'), []);
  saveAssistantMemory([{ role: 'user', content: 'hello from guest' }], 'guest:fixture');
  assert.equal(loadAssistantMemory('guest:fixture')[0].content, 'hello from guest');
  assert.deepEqual(loadAssistantMemory(null), []);
});

test('a fresh storage read retains conversation but omits document dictation and echoed bodies', () => {
  saveAssistantMemory([
    { role: 'user', content: 'My favorite color is blue' },
    { role: 'assistant', content: 'Blue it is!' },
    { role: 'user', content: 'could you update note travel saying PASSPORT-SECRET' },
    { role: 'assistant', content: 'The value is PASSPORT-SECRET' },
  ], 'returning-user');
  const reloaded = loadAssistantMemory('returning-user');
  assert.equal(reloaded[0].content, 'My favorite color is blue');
  assert.doesNotMatch(JSON.stringify(reloaded), /PASSPORT-SECRET/);
  assert.doesNotMatch([...storage.values()].join(' '), /PASSPORT-SECRET/);
  const key = [...storage.keys()].find(k => k.endsWith('returning-user'))!;
  storage.set(key, '{broken');
  assert.deepEqual(loadAssistantMemory('returning-user'), []);
  storage.set(key, 'x'.repeat(20_000));
  assert.deepEqual(loadAssistantMemory('returning-user'), []);
});

test('blocked storage cannot crash the assistant', t => {
  t.mock.method(localStorage, 'getItem', () => { throw new Error('blocked'); });
  t.mock.method(localStorage, 'setItem', () => { throw new Error('quota'); });
  assert.deepEqual(loadAssistantMemory('account-a'), []);
  assert.doesNotThrow(() => saveAssistantMemory([{ role: 'user', content: 'hello' }], 'account-a'));
});

test('history sent to the brain remains short and private-body free', () => {
  const history = compactAssistantHistory([
    { role: 'user', content: 'add note private title about very private body text' },
    { role: 'assistant', content: 'Added note “private title”.' },
    ...Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `turn ${i}` })),
  ]);
  assert.ok(history.length <= 8);
  assert.ok(history.reduce((n, item) => n + item.content.length, 0) <= ASSISTANT_MEMORY_MAX_CHARS);
  assert.doesNotMatch(JSON.stringify(history), /very private body text/);
});

test('local parser handles explicit natural phrasing without broad destructive matches', () => {
  assert.equal(parseCommand('Could you add grab milk tomorrow to my tasks please?').kind, 'add_task');
  assert.deepEqual(parseCommand('mark the task laundry done'), { kind: 'complete_task', title_match: 'laundry' });
  assert.deepEqual(parseCommand('reopen task laundry'), { kind: 'reopen_task', title_match: 'laundry' });
  assert.deepEqual(parseCommand('review my week'), { kind: 'summarize_week' });
  assert.deepEqual(parseCommand('find passport anywhere'), { kind: 'search_all', query: 'passport' });
  assert.equal(parseCommand('delete all tasks').kind, 'unknown');
  for (const phrase of ['mark gym done', 'mark task laundry blue', 'I want to delete task milk', 'add task milk but do not save it', 'could you not delete task milk']) assert.equal(parseCommand(phrase).kind, 'unknown', phrase);
  assert.deepEqual(parseCommand('Could you show my notes please?'), { kind: 'navigate', page: 'library', tab: 'notes' });
});

test('provider quota fallback copy never exposes raw busy or request-limit wording', () => {
  assert.doesNotMatch(ASSISTANT_ERRORS.rate_limit, /busy|request limit/i);
  assert.doesNotMatch(ASSISTANT_ERRORS.rate_limit_daily, /busy|request limit/i);
});
