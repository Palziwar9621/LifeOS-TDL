import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getClient } from '../src/lib/supabase.ts';
import { askBrain, AssistantError } from '../src/lib/brain.ts';
import { executeCommand, buildAppContext, saveAssistantSettings, getAssistantSettings } from '../src/lib/voice.ts';
import * as db from '../src/lib/db.ts';

const storage = new Map<string, string>();
const context = { page: 'home', pageParams: {}, navigate: () => {} };
const validSession = () => ({ access_token: 'fixture-access-not-a-secret', refresh_token: 'fixture-refresh-not-a-secret', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'authenticated-fixture' } });
const sessionResult = (session: unknown) => ({ data: { session }, error: null });
const plan = { data: { reply: '', calls: [{ name: 'add_task', args: { title: 'Remote fixture' } }] }, error: null };
const brain = (signal?: AbortSignal) => askBrain('add task Remote fixture', buildAppContext('home', {}), [], signal);
function httpError(status: number, body: unknown = {}) { return { data: null, error: { context: new Response(JSON.stringify(body), { status }) } }; }
function mockInvoke(t: any, invoke: (...args: any[]) => any) {
  const functions = getClient()!.functions;
  t.mock.method(getClient()!, 'functions', () => functions, { getter: true });
  return t.mock.method(functions, 'invoke', invoke);
}
before(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { location: { hash: '' } }) });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  storage.set('lifeos.guest', '1');
  storage.set('lifeos.supabase', JSON.stringify({ url: 'https://failure-boundary.invalid', anonKey: 'fixture-not-a-secret' }));
  await db.initStore('truthy-but-not-authenticated-guest');
});
after(async () => { await db.resetStore(); });

test('guest id is not authentication; missing session never invokes remote AI', async t => {
  const sb = getClient()!;
  t.mock.method(sb.auth, 'getSession', async () => sessionResult(null));
  const refresh = t.mock.method(sb.auth, 'refreshSession', async () => { throw new Error('must not refresh a guest'); });
  const invoke = mockInvoke(t, async () => plan);
  assert.ok(db.currentUserId());
  await assert.rejects(brain(), (e: AssistantError) => e.code === 'guest' && e.offlineAllowed);
  assert.equal(invoke.mock.callCount(), 0); assert.equal(refresh.mock.callCount(), 0);
  saveAssistantSettings({ ...getAssistantSettings(), useAI: true });
  const unknown = await executeCommand('recolor my planner blocks', context);
  assert.equal(unknown.errorCode, 'guest'); assert.doesNotMatch(unknown.message, /Offline, I can/);
  assert.equal((await executeCommand('add task explicit guest fixture', context)).ok, true);
});

test('fresh session is used explicitly without refresh; expiry refreshes once', async t => {
  const sb = getClient()!;
  let session = validSession();
  t.mock.method(sb.auth, 'getSession', async () => sessionResult(session));
  const refresh = t.mock.method(sb.auth, 'refreshSession', async () => sessionResult({ ...validSession(), access_token: 'fixture-renewed' }));
  const invoke = mockInvoke(t, async (_name: string, options: any) => {
    assert.equal(options.headers.Authorization, `Bearer ${refresh.mock.callCount() ? 'fixture-renewed' : session.access_token}`);
    return plan;
  });
  assert.equal((await brain()).calls.length, 1); assert.equal(refresh.mock.callCount(), 0);
  session = { ...session, expires_at: 1 };
  await brain(); assert.equal(refresh.mock.callCount(), 1); assert.equal(invoke.mock.callCount(), 2);
});

test('gateway 401 gets one refresh and retry; persistent rejection stays auth_expired', async t => {
  const sb = getClient()!;
  t.mock.method(sb.auth, 'getSession', async () => sessionResult(validSession()));
  const refresh = t.mock.method(sb.auth, 'refreshSession', async () => sessionResult(validSession()));
  let calls = 0, recover = true;
  mockInvoke(t, async () => (++calls % 2 === 0 && recover) ? plan : httpError(401, { message: 'SECRET provider text' }));
  await brain(); assert.equal(calls, 2); assert.equal(refresh.mock.callCount(), 1);
  recover = false;
  await assert.rejects(brain(), (e: AssistantError) => e.code === 'auth_expired' && !e.message.includes('SECRET'));
  assert.equal(calls, 4); assert.equal(refresh.mock.callCount(), 2);
});

test('expired session with rejected refresh never sends the stale access token', async t => {
  const sb = getClient()!;
  t.mock.method(sb.auth, 'getSession', async () => sessionResult({ ...validSession(), expires_at: 1 }));
  const refresh = t.mock.method(sb.auth, 'refreshSession', async () => ({ data: { session: null }, error: { status: 401, message: 'SECRET refresh token' } }));
  const invoke = mockInvoke(t, async () => plan);
  await assert.rejects(brain(), (e: AssistantError) => e.code === 'auth_expired' && !e.message.includes('SECRET'));
  assert.equal(refresh.mock.callCount(), 1); assert.equal(invoke.mock.callCount(), 0);
});

test('typed provider failures are sanitized and never become offline writes', async t => {
  const sb = getClient()!;
  t.mock.method(sb.auth, 'getSession', async () => sessionResult(validSession()));
  let result: any;
  mockInvoke(t, async () => result);
  saveAssistantSettings({ ...getAssistantSettings(), useAI: true });
  const victim = await db.createTask({ title: 'Failure boundary victim' });
  for (const [status, code] of [[429, 'rate_limit'], [503, 'unconfigured'], [502, 'invalid_contract'], [502, 'unavailable']] as const) {
    result = httpError(status, { code, error: 'SECRET upstream request, token, body' });
    await assert.rejects(brain(), (e: AssistantError) => e.code === code && !e.message.includes('SECRET'));
    const command = await executeCommand('delete task Failure boundary victim', context);
    assert.equal(command.errorCode, code); assert.equal(command.ok, false);
    assert.equal(db.dbState().tasks.find(row => row.id === victim.id)?.deleted, false);
  }
  result = { data: null, error: new Error('SECRET network body') };
  const failure = await executeCommand('add task Unsafe fallback fixture', context);
  assert.equal(failure.errorCode, 'network'); assert.doesNotMatch(failure.message, /SECRET/);
  assert.equal(db.dbState().tasks.some(row => row.title === 'Unsafe fallback fixture'), false);
});

test('whole plan validates before execution, including malformed or empty responses', async t => {
  const sb = getClient()!;
  t.mock.method(sb.auth, 'getSession', async () => sessionResult(validSession()));
  let data: any;
  let error: Error | null = null;
  mockInvoke(t, async () => ({ data, error }));
  for (const malformed of [null, { reply: '', calls: [] }, { reply: '', calls: [{ name: 'add_task', args: { title: 'Partial plan fixture' } }, { name: 'delete_everything', args: {} }] }]) {
    data = malformed;
    assert.equal((await executeCommand('add task Unsafe malformed fallback', context)).errorCode, 'invalid_contract');
  }
  error = new SyntaxError('SECRET invalid JSON');
  assert.equal((await executeCommand('add task Unsafe malformed fallback', context)).errorCode, 'invalid_contract');
  assert.equal(db.dbState().tasks.some(row => /Partial plan fixture|Unsafe malformed fallback/.test(row.title)), false);
});

test('offline-only explicit commands work; unsupported requests identify AI disabled', async t => {
  const invoke = mockInvoke(t, async () => { throw new Error('offline should not invoke'); });
  saveAssistantSettings({ ...getAssistantSettings(), useAI: false });
  assert.equal((await executeCommand('add task Offline fixture', context)).ok, true);
  assert.equal((await executeCommand('add milestone for my project', context)).errorCode, 'ai_disabled');
  assert.equal(invoke.mock.callCount(), 0);
});

test('aborted and hung auth/invoke requests settle without local fallback', async t => {
  const sb = getClient()!;
  let hangAuth = false;
  t.mock.method(sb.auth, 'getSession', async () => hangAuth ? new Promise(() => {}) : sessionResult(validSession()));
  let invoked!: () => void;
  const ready = new Promise<void>(resolve => { invoked = resolve; });
  mockInvoke(t, async () => { invoked(); return new Promise(() => {}); });
  saveAssistantSettings({ ...getAssistantSettings(), useAI: true });
  const controller = new AbortController();
  const pending = executeCommand('add task Aborted fixture', context, [], controller.signal);
  await ready; controller.abort();
  assert.equal((await pending).cancelled, true);
  assert.equal(db.dbState().tasks.some(row => row.title === 'Aborted fixture'), false);
  hangAuth = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pendingAuth = brain();
    const rejected = assert.rejects(pendingAuth, (e: AssistantError) => e.code === 'network');
    t.mock.timers.tick(5_001); await rejected;
  } finally { t.mock.timers.reset(); }
});
