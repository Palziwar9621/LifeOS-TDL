import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantHandler, selectAssistantTools } from '../supabase/functions/assistant/runtime.ts';
import { TOOLS } from '../supabase/functions/assistant/contract.ts';

const request = (spoken = 'add task Call Sam', signal?: AbortSignal) => new Request('https://assistant.invalid', { method: 'POST', signal, headers: { Authorization: 'Bearer fixture-not-a-secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ spoken, ctx: { today: '2026-10-10', privateBody: 'PRIVATE' }, history: [] }) });
const success = (name = 'add_task', args = { title: 'Call Sam' } as any) => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }));
const env = (name: string) => ({ SUPABASE_URL: 'https://assistant.invalid', SUPABASE_ANON_KEY: 'fixture-anon', GROQ_API_KEY: 'fixture-provider-secret' })[name];
function fixture(fetch: (url: string, init: RequestInit) => Promise<Response>, verifyUser = async () => true) { return createAssistantHandler({ env, verifyUser, fetch }); }

test('schema budget narrows 68-tool request; history retains fine controls and unknowns stay broad', () => {
  assert.equal(TOOLS.length, 68);
  assert.ok(JSON.stringify(TOOLS).length > 25_000);
  for (const utterance of ['add task Call Sam', 'snooze reminder Dentist ten minutes', 'rename a subtask', 'update milestone', 'change planner block color', 'attach a tag to a task']) {
    const selected = selectAssistantTools(utterance);
    assert.equal(selected.narrow, true, utterance);
    assert.ok(selected.tools.length <= 22); assert.ok(JSON.stringify(selected.tools).length <= 8_000);
  }
  const history = selectAssistantTools('move it to Monday', [{ role: 'user', content: 'update the planner block Study' }, { role: 'assistant', content: 'Which day?' }]);
  assert.ok(history.tools.some(t => t.function.name === 'update_schedule_block'));
  const broad = selectAssistantTools('make that one blue');
  assert.equal(broad.narrow, false); assert.equal(broad.model, 'openai/gpt-oss-120b'); assert.equal(broad.tools.length, 68);
  const multiarea = selectAssistantTools('update tasks projects goals notes reminders routines milestones tags categories and calendar blocks');
  assert.equal(multiarea.narrow, false);
});

test('provider failures recover once via the cheap narrow retry before any broad call', async () => {
  for (const status of [400, 404, 500, 503]) {
    const sent: any[] = [];
    const handler = fixture(async (_url, init) => {
      sent.push(JSON.parse(init.body as string));
      return sent.length === 1 ? new Response('SECRET provider body', { status }) : success();
    });
    const response = await handler(request());
    assert.equal(response.status, 200); assert.equal((await response.json()).calls[0].name, 'add_task');
    // narrow fails once → retried in place → second narrow call succeeds; broad never sent
    assert.equal(sent.length, 2);    assert.equal(sent[0].model, 'openai/gpt-oss-20b');
    assert.equal(sent[1].model, 'openai/gpt-oss-20b'); assert.ok(sent[1].tools.length <= 23);
    assert.doesNotMatch(JSON.stringify(sent), /PRIVATE/);
  }
});

test('429 with retry-after 0 uses a bounded default pause and retries the narrow set in place', async () => {
  const sent: any[] = [];
  const handler = fixture(async (_url, init) => {
    sent.push(JSON.parse(init.body as string));
    return sent.length === 1
      ? new Response('SECRET provider body', { status: 429, headers: { 'retry-after': '0' } })
      : success();
  });
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).calls[0].name, 'add_task');
  // no usable retry-after → bounded default pause, narrow retried in place; broad never needed
  assert.equal(sent.length, 2);
  assert.equal(sent[0].model, 'openai/gpt-oss-20b');
  assert.equal(sent[1].model, 'openai/gpt-oss-20b');
  assert.doesNotMatch(JSON.stringify(sent), /PRIVATE/);
});

test('all-provider rate limits remain typed 429; auth/config/provider errors never leak bodies', async () => {
  let count = 0;
  let handler = fixture(async () => { count++; return new Response('SECRET provider key and prompt', { status: 429 }); });
  let response = await handler(request());
  assert.equal(response.status, 429); assert.equal(count, 3); // narrow, narrow retry, broad
  assert.deepEqual(await response.json(), { error: 'Assistant request failed', code: 'rate_limit' });
  count = 0;
  handler = fixture(async () => { count++; return new Response('SECRET provider key', { status: 401 }); });
  response = await handler(request());
  assert.equal(response.status, 503); assert.equal(count, 1); assert.equal((await response.json()).code, 'unconfigured');
  count = 0;
  handler = fixture(async () => { count++; return success(); }, async () => false);
  response = await handler(request());
  assert.equal(response.status, 401); assert.equal(count, 0); assert.equal((await response.json()).code, 'auth_expired');
});

test('persistent provider model failures and missing configuration have bounded typed failures', async () => {
  let count = 0;
  const handler = fixture(async () => { count++; return new Response('SECRET model diagnostics', { status: 500 }); });
  const response = await handler(request());
  // narrow attempt 502 retried once in place, then broad attempt: total 3
  assert.equal(count, 3); assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Assistant request failed', code: 'unavailable' });
  const missing = createAssistantHandler({ env: name => name === 'GROQ_API_KEY' ? undefined : env(name), verifyUser: async () => true, fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal((await (await missing(request())).json()).code, 'unconfigured');
});

test('narrowed no-action response gets broad capability recovery instead of losing a command', async () => {
  let count = 0;
  const response = await fixture(async (_url, init) => {
    count++;
    if (count === 1) return new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot change that.' } }] }));
    assert.equal(JSON.parse(init.body as string).tools.length, 68);
    return success('set_task_tag', { title_match: 'Call Sam', tag_match: 'Work', attached: true });
  })(request('label task Call Sam Work'));
  assert.equal(response.status, 200); assert.equal(count, 2);
  assert.equal((await response.json()).calls[0].name, 'set_task_tag');
});

test('omitted capabilities can request a full contract without committing a partial plan', async () => {
  let count = 0;
  const response = await fixture(async (_url, init) => {
    count++;
    const body = JSON.parse(init.body as string);
    if (count === 1) {
      assert.ok(body.tools.some((t: any) => t.function.name === 'request_full_toolset'));
      assert.match(body.messages[0].content, /update_milestone/);
      return success('request_full_toolset', {});
    }
    assert.equal(body.tools.length, 68);
    return success('update_milestone', { scope: 'project', name_match: 'Garden', title_match: 'Dig', done: true });
  })(request('finish task Dig in Garden'));
  assert.equal(response.status, 200); assert.equal(count, 2);
  assert.equal((await response.json()).calls[0].name, 'update_milestone');
});

test('invalid/truncated/unknown tool contracts are errors, never a successful empty plan', async () => {
  for (const body of [
    'not json SECRET',
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }),
    JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'delete_task', arguments: '{"title_match":null}' } }] } }] }),
    JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'delete_everything', arguments: '{}' } }] } }] }),
  ]) {
    let count = 0;
    const response = await fixture(async () => { count++; return new Response(body); })(request());
    assert.equal(response.status, 502); assert.equal((await response.json()).code, 'invalid_contract');
    assert.equal(count, 1);
  }
});

test('edge cancellation and deadline stop pending providers with no second request', async t => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let count = 0;
  const handler = fixture(async () => { count++; started(); return new Promise(() => {}); });
  const controller = new AbortController();
  const pending = handler(request('add task Call Sam', controller.signal));
  await ready; controller.abort();
  assert.equal((await (await pending).json()).code, 'cancelled'); assert.equal(count, 1);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pendingTimeout = createAssistantHandler({ env, verifyUser: async () => new Promise(() => {}), fetch: async () => success() })(request());
    t.mock.timers.tick(20_001);
    assert.equal((await (await pendingTimeout).json()).code, 'network');
  } finally { t.mock.timers.reset(); }
});
