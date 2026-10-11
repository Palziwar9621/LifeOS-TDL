import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantHandler, selectAssistantModel } from '../supabase/functions/assistant/runtime.ts';
import { TOOLS } from '../supabase/functions/assistant/contract.ts';

const request = (spoken = 'add task Call Sam', signal?: AbortSignal) => new Request('https://assistant.invalid', { method: 'POST', signal, headers: { Authorization: 'Bearer fixture-not-a-secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ spoken, ctx: { today: '2026-10-10', privateBody: 'PRIVATE' }, history: [] }) });
const success = (name = 'add_task', args = { title: 'Call Sam' } as any) => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }));
const env = (name: string) => ({ SUPABASE_URL: 'https://assistant.invalid', SUPABASE_ANON_KEY: 'fixture-anon', GROQ_API_KEY: 'fixture-provider-secret' })[name];
function fixture(fetch: (url: string, init: RequestInit) => Promise<Response>, verifyUser = async () => true) { return createAssistantHandler({ env, verifyUser, fetch }); }

test('every turn sends the full 71-tool contract; long or history-heavy turns escalate to the large model', () => {
  assert.equal(TOOLS.length, 75);
  assert.ok(JSON.stringify(TOOLS).length > 25_000);
  for (const spoken of ['add task Call Sam', 'snooze reminder Dentist ten minutes', 'finish task Dig in Garden', 'make that one blue']) {
    assert.equal(selectAssistantModel(spoken), 'small', spoken);
  }
  assert.equal(selectAssistantModel('please update the garden project milestone called dig to completed and then also move the sprinkler repair task to next tuesday morning at nine with a reminder'), 'large');
  assert.equal(selectAssistantModel('move it to Monday', [{ role: 'user', content: 'update the planner block Study' }, { role: 'assistant', content: 'Which day?' }]), 'small');
  assert.equal(selectAssistantModel('ok do it', new Array(4).fill(0).map((_, i) => ({ role: 'user', content: `turn ${i}` }))), 'large');
});

test('provider failures move to the next tier with the full contract', async () => {
  for (const status of [400, 404, 500, 503]) {
    const sent: any[] = [];
    const handler = fixture(async (_url, init) => {
      sent.push(JSON.parse(init.body as string));
      return sent.length === 1 ? new Response('SECRET provider body', { status }) : success();
    });
    const response = await handler(request());
    assert.equal(response.status, 200); assert.equal((await response.json()).calls[0].name, 'add_task');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].tools.length, 75); assert.equal(sent[1].tools.length, 75);
    assert.equal(sent[0].reasoning_effort, 'low');
    assert.doesNotMatch(JSON.stringify(sent), /PRIVATE/);
  }
});

test('429 with retry-after 0 pauses briefly then moves to the next provider', async () => {
  const sent: any[] = [];
  const handler = fixture(async (_url, init) => {
    sent.push(JSON.parse(init.body as string));
    return sent.length === 1
      ? new Response('SECRET provider body', { status: 429, headers: { 'retry-after': '0' } })
      : success();
  });
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).calls[0].name, 'add_task');
  assert.equal(sent.length, 2);
  assert.doesNotMatch(JSON.stringify(sent), /PRIVATE/);
});

test('413 payload caps retry the same tier with a compact prompt; tools stay complete', async () => {
  const sent: any[] = [];
  const handler = fixture(async (_url, init) => {
    sent.push(JSON.parse(init.body as string));
    return sent.length === 1 ? new Response('SECRET provider body', { status: 413 }) : success();
  });
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).calls[0].name, 'add_task');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].max_tokens, 1000); assert.equal(sent[1].max_tokens, 700);
  assert.equal(sent[1].tools.length, 75);
  assert.ok(sent[1].messages[0].content.length < sent[0].messages[0].content.length);
  assert.match(sent[1].messages[0].content, /Local context/);
  assert.doesNotMatch(JSON.stringify(sent), /PRIVATE/);
});

test('a payload-too-large fallback keeps the earlier tier error code', async () => {
  let count = 0;
  const handler = fixture(async () => { count++; return count === 1 ? new Response('SECRET', { status: 429 }) : new Response('SECRET', { status: 413 }); });
  const response = await handler(request());
  assert.equal(count, 3); // primary 429 → fallback full 413 → fallback compact 413
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'Assistant request failed', code: 'rate_limit' });
});

test('all-provider rate limits remain typed 429; auth/config/provider errors never leak bodies', async () => {
  let count = 0;
  let handler = fixture(async () => { count++; return new Response('SECRET provider key and prompt', { status: 429 }); });
  let response = await handler(request());
  assert.equal(response.status, 429); assert.equal(count, 2); // primary then fallback
  assert.deepEqual(await response.json(), { error: 'Assistant request failed', code: 'rate_limit' });
  count = 0;
  handler = fixture(async () => { count++; return new Response('SECRET provider key', { status: 401 }); });
  response = await handler(request());
  assert.equal(response.status, 503); assert.equal(count, 2); // bad primary key falls through to fallback, then unconfigured
  assert.equal((await response.json()).code, 'unconfigured');
  count = 0;
  handler = fixture(async () => { count++; return success(); }, async () => false);
  response = await handler(request());
  assert.equal(response.status, 401); assert.equal(count, 0); assert.equal((await response.json()).code, 'auth_expired');
});

test('persistent provider model failures and missing configuration have bounded typed failures', async () => {
  let count = 0;
  const handler = fixture(async () => { count++; return new Response('SECRET model diagnostics', { status: 500 }); });
  const response = await handler(request());
  assert.equal(count, 2); assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Assistant request failed', code: 'unavailable' });
  const missing = createAssistantHandler({ env: name => name === 'GROQ_API_KEY' ? undefined : env(name), verifyUser: async () => true, fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal((await (await missing(request())).json()).code, 'unconfigured');
});

test('prose instead of a plan gets one more provider try before being accepted', async () => {
  let count = 0;
  const response = await fixture(async (_url, init) => {
    count++;
    if (count === 1) return new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot change that.' } }] }));
    assert.equal(JSON.parse(init.body as string).tools.length, 75);
    return success('set_task_tag', { title_match: 'Call Sam', tag_match: 'Work', attached: true });
  })(request('label task Call Sam Work'));
  assert.equal(response.status, 200); assert.equal(count, 2);
  assert.equal((await response.json()).calls[0].name, 'set_task_tag');
});

test('tertiary tier runs only when configured and sits between primary and fallback', async () => {
  const seen: string[] = [];
  const baseEnv = { SUPABASE_URL: 'https://assistant.invalid', SUPABASE_ANON_KEY: 'fixture-anon', GROQ_API_KEY: 'fixture-provider-secret' };
  const withTertiary = createAssistantHandler({
    env: name => ({ ...baseEnv, ASSISTANT_TERTIARY_KEY: 'fixture-openrouter-key' })[name], verifyUser: async () => true,
    fetch: async (url, _init) => { seen.push(String(url)); return seen.length === 1 ? new Response('SECRET', { status: 500 }) : success('query_tasks', { date_range: 'today' }); },
  });
  const ok = await withTertiary(request('what do I have today'));
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, ['https://api.groq.com/openai/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions']);
  seen.length = 0;
  const withoutTertiary = createAssistantHandler({
    env: name => baseEnv[name],
    verifyUser: async () => true,
    fetch: async (url, _init) => { seen.push(String(url)); return seen.length === 1 ? new Response('SECRET', { status: 500 }) : success('query_tasks', { date_range: 'today' }); },
  });
  const ok2 = await withoutTertiary(request('what do I have today'));
  assert.equal(ok2.status, 200);
  assert.deepEqual(seen, ['https://api.groq.com/openai/v1/chat/completions', 'https://api.groq.com/openai/v1/chat/completions']);
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

test('a hanging primary is abandoned after the attempt timeout and the fallback still answers', async () => {
  const sent: string[] = [];
  const fast = createAssistantHandler({
    env: name => ({ SUPABASE_URL: 'https://assistant.invalid', SUPABASE_ANON_KEY: 'fixture-anon', GROQ_API_KEY: 'fixture-provider-secret', ASSISTANT_ATTEMPT_TIMEOUT_MS: '60' })[name],
    verifyUser: async () => true,
    fetch: async (url) => { sent.push(String(url)); return sent.length === 1 ? new Promise<Response>(() => {}) : success(); },
  });
  const response = await fast(request('add task Call Sam'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).calls[0].name, 'add_task');
  assert.equal(sent.length, 2);
}, { timeout: 5000 });

test('daily-cap 429 (hours-long retry-after) fails fast as rate_limit_daily with no pointless waits', async () => {
  let count = 0;
  const handler = fixture(async () => { count++; return new Response('SECRET provider body', { status: 429, headers: { 'retry-after': '3600' } }); });
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'Assistant request failed', code: 'rate_limit_daily' });
  assert.equal(count, 2); // primary daily cap falls through to fallback, also daily-capped; no waits
});

test('provider is env-configurable; defaults stay Groq when env is unset', async () => {
  const sent: { url: string; auth?: string; model?: string }[] = [];
  const custom = createAssistantHandler({
    env: name => ({ SUPABASE_URL: 'https://assistant.invalid', SUPABASE_ANON_KEY: 'fixture-anon', ASSISTANT_API_KEY: 'fixture-alternative-key', ASSISTANT_API_URL: 'https://api.alternative.invalid/v1/chat/completions', ASSISTANT_SMALL_MODEL: 'alt-small', ASSISTANT_LARGE_MODEL: 'alt-large' })[name],
    verifyUser: async () => true,
    fetch: (url, init) => { sent.push({ url, auth: (init.headers as any).Authorization, model: JSON.parse(init.body as string).model }); return Promise.resolve(success()); },
  });
  const simple = await custom(request('add task Call Sam'));
  assert.equal(simple.status, 200);
  assert.equal(sent[0].url, 'https://api.alternative.invalid/v1/chat/completions');
  assert.equal(sent[0].auth, 'Bearer fixture-alternative-key');
  assert.equal(sent[0].model, 'alt-small');
  const long = await custom(request('please update the garden project milestone called dig to completed and then also move the sprinkler repair task to next tuesday morning at nine with a reminder and tell me what else is left today'));
  assert.equal(long.status, 200);
  assert.equal(sent[1].model, 'alt-large');
});

test('turn context carries real titles so first-try matching works; private fields never leave the device', async () => {
  let wire: any;
  const handler = fixture(async (_url, init) => { wire = JSON.parse(init.body as string); return success('complete_routine', { title_match: 'Gym' }); });
  const response = await handler(new Request('https://assistant.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture-not-a-secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ spoken: 'mark the gym done', ctx: { today: '2026-10-10', privateBody: 'PRIVATE', recentTaskTitles: ['Laundry'], routines: ['Gym'], projects: ['Garden'], categories: ['Home'] }, history: [] }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).calls[0].name, 'complete_routine');
  const system = wire.messages.find((m: any) => m.role === 'system').content as string;
  assert.match(system, /recentTaskTitles/);
  assert.match(system, /Laundry/);
  assert.match(system, /routines/);
  assert.match(system, /Garden/);
  assert.match(system, /Home/);
  assert.doesNotMatch(JSON.stringify(wire), /PRIVATE/);
});
