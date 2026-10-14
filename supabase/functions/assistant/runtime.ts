import { TOOLS, SYSTEM_PROMPT, validateToolCall } from './contract.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const failure = (code: string, status: number) => json({ error: 'Assistant request failed', code }, status);
const SMALL_MODEL = 'openai/gpt-oss-20b';
const LARGE_MODEL = 'openai/gpt-oss-120b';
const ATTEMPT_TIMEOUT_MS = 9_000;
const TURN_TIMEOUT_MS = 20_000;
// Compact prompt for providers whose token-per-minute budget cannot fit the
// full contract (~8.4k tokens → Groq on_demand answers 413). Every tool stays
// listed; only the guidance prose and the completion budget shrink.
const COMPACT_SYSTEM_PROMPT = 'You are the voice brain of a personal productivity app. Map the request to the closest listed tool and return tool calls — never claim an action happened. Copy exact item titles from the local context lists into *_match fields; run a query tool first when unsure. Use ctx.today/weekday/time for dates; HH:mm is 24-hour. Multi-part requests become up to 6 tool calls in spoken order; leave reply empty when calling tools. If no listed tool fits, reply briefly asking for details or explaining. Delete only on explicit user request.';
type History = { role: string; content: string }[];

type ProviderCooldown = { until: number; code: 'rate_limit' | 'rate_limit_daily' };

// A short request can still need the stronger model when it refers back to a
// previous target ("move it") or repairs a prior instruction ("actually...").
// These signals are deliberately narrow: ordinary small talk and one-step
// commands should keep the faster model.
const ACTION_WORDS = /\b(?:add|archive|complete|copy|create|delete|duplicate|edit|finish|label|mark|move|open|query|remove|rename|reopen|reschedule|restore|schedule|search|set|show|snooze|tag|tick|untick|update)\b/g;
const REFERENTIAL_WORDS = /\b(?:it|that|this|these|those|one|ones|them|same|another)\b/;
const CORRECTION_WORDS = /\b(?:actually|correction|instead|rather|wait|i meant|make that|change that|no[, ]+not|undo)\b/;
const MULTI_STEP_WORDS = /\b(?:and then|then also|after that|also|as well as|plus)\b|;/;

function actionCount(spoken: string): number {
  ACTION_WORDS.lastIndex = 0;
  const count = [...spoken.toLowerCase().matchAll(ACTION_WORDS)].length;
  ACTION_WORDS.lastIndex = 0;
  return count;
}

function needsContextModel(spoken: string, history: History): boolean {
  const normalized = spoken.trim().toLowerCase();
  const refersBack = REFERENTIAL_WORDS.test(normalized) && (history.length > 0 || ACTION_WORDS.test(normalized));
  ACTION_WORDS.lastIndex = 0;
  return refersBack || CORRECTION_WORDS.test(normalized) || MULTI_STEP_WORDS.test(normalized) || actionCount(normalized) > 1;
}

// Used only to decide whether a tool-less answer warrants another provider.
// A greeting or a normal question should be returned as-is; explicit app
// requests still get a chance on the next tier if the first model missed a
// tool call.
function isLikelyActionRequest(spoken: string): boolean {
  const normalized = spoken.toLowerCase();
  ACTION_WORDS.lastIndex = 0;
  const action = ACTION_WORDS.test(normalized);
  ACTION_WORDS.lastIndex = 0;
  return action || /\b(?:what(?:'s| is)\s+(?:on|left|due|scheduled)|where is|how am i doing|summarize|review my|tell me what)\b/.test(normalized);
}

function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

// Every turn sends the full tool contract: narrowing saved a few hundred ms
// but made the model blind to most capabilities, causing missed actions. The
// fast small model handles ordinary commands; context-dependent, long,
// multi-part or history-heavy turns escalate to the stronger large model.
export function selectAssistantModel(spoken: string, history: History = []): 'small' | 'large' {
  if (spoken.length > 120) return 'large';
  if (history.length >= 4 || history.some(h => h.content.length > 150)) return 'large';
  if (needsContextModel(spoken, history)) return 'large';
  return 'small';
}

export interface AssistantDependencies {
  env: (name: string) => string | undefined;
  verifyUser: (authorization: string, url: string, anonKey: string) => Promise<boolean>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}

export function createAssistantHandler(deps: AssistantDependencies) {
  // Cooldowns live for the lifetime of this handler, so a repeated request in
  // the same edge worker does not immediately hit a tier that asked us to
  // wait. The model is part of the key: a provider's small model can be
  // capped while its configured fallback model remains usable.
  const cooldowns = new Map<string, ProviderCooldown>();

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return failure('invalid_contract', 405);
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.signal.addEventListener('abort', abort, { once: true });
    if (req.signal.aborted) abort();
    const timeout = setTimeout(abort, TURN_TIMEOUT_MS);
    // The whole turn is bounded, including auth, body parsing and provider JSON.
    async function bounded<T>(promise: Promise<T>): Promise<T> {
      controller.signal.throwIfAborted();
      let stop!: () => void;
      try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
          stop = () => reject(new DOMException('Request stopped', 'AbortError'));
          controller.signal.addEventListener('abort', stop, { once: true });
        })]);
      } finally { controller.signal.removeEventListener('abort', stop); }
    }
    try {
      controller.signal.throwIfAborted();
      const url = deps.env('SUPABASE_URL'), anonKey = deps.env('SUPABASE_ANON_KEY');
      if (!url || !anonKey) return failure('unconfigured', 503);
      const auth = req.headers.get('Authorization') ?? '';
      if (!/^Bearer\s+\S+$/i.test(auth) || !await bounded(deps.verifyUser(auth, url, anonKey))) return failure('auth_expired', 401);
      let body;
      try { body = await bounded(req.json()); } catch (error) { if (controller.signal.aborted) throw error; return failure('invalid_contract', 400); }
      const { spoken, ctx, history } = body ?? {};
      if (typeof spoken !== 'string' || !spoken.trim() || spoken.length > 500) return failure('invalid_contract', 400);
      const safeHistory: History = [];
      if (Array.isArray(history)) for (const h of history.slice(-8)) {
        if (h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string') safeHistory.push({ role: h.role, content: h.content.slice(0, 300) });
      }
      const safeCtx: Record<string, string | number | string[]> = {};
      if (ctx && typeof ctx === 'object') {
        for (const key of ['page', 'today', 'weekday', 'time']) if (typeof ctx[key] === 'string') safeCtx[key] = ctx[key].slice(0, 60);
        for (const key of ['todayTaskCount', 'timezoneOffsetMinutes']) if (typeof ctx[key] === 'number' && Number.isFinite(ctx[key])) safeCtx[key] = ctx[key];
        // Real titles/names: the model copies exact match strings from these
        // instead of guessing, so "mark it done" resolves on the first try.
        for (const key of ['recentTaskTitles', 'routines', 'projects', 'categories']) {
          const value = (ctx as Record<string, unknown>)[key];
          if (Array.isArray(value)) safeCtx[key] = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.slice(0, 60)).slice(0, 15);
        }
      }
      // Provider chain, tried in order on the full contract:
      //   primary (Gemini via ASSISTANT_*) → tertiary (e.g. OpenRouter, only
      // when ASSISTANT_TERTIARY_KEY is set) → fallback (Groq). Each attempt is
      // individually time-boxed so one hanging provider cannot consume the
      // whole 20s turn budget before the others run.
      const primary = {
        url: deps.env('ASSISTANT_API_URL') || 'https://api.groq.com/openai/v1/chat/completions',
        smallModel: deps.env('ASSISTANT_SMALL_MODEL') || SMALL_MODEL,
        largeModel: deps.env('ASSISTANT_LARGE_MODEL') || LARGE_MODEL,
        key: deps.env('ASSISTANT_API_KEY') || deps.env('GROQ_API_KEY') || '',
      };
      const tertiary = {
        url: deps.env('ASSISTANT_TERTIARY_URL') || 'https://openrouter.ai/api/v1/chat/completions',
        model: deps.env('ASSISTANT_TERTIARY_MODEL') || 'google/gemini-3.5-flash',
        key: deps.env('ASSISTANT_TERTIARY_KEY') || '',
      };
      const fallback = {
        url: deps.env('ASSISTANT_FALLBACK_URL') || 'https://api.groq.com/openai/v1/chat/completions',
        model: deps.env('ASSISTANT_FALLBACK_MODEL') || LARGE_MODEL,
        key: deps.env('ASSISTANT_FALLBACK_KEY') || deps.env('GROQ_API_KEY') || '',
      };
      if (!primary.key) return failure('unconfigured', 503);
      // Tunable for tests; production default 9s per provider attempt.
      const attemptTimeoutMs = Math.max(1, Number(deps.env('ASSISTANT_ATTEMPT_TIMEOUT_MS')) || ATTEMPT_TIMEOUT_MS);
      const model = selectAssistantModel(spoken, safeHistory);
      const primaryAttempt = { url: primary.url, key: primary.key, model: model === 'large' ? primary.largeModel : primary.smallModel };
      const attempts = [primaryAttempt, ...(tertiary.key ? [{ url: tertiary.url, key: tertiary.key, model: tertiary.model }] : []), { url: fallback.url, key: fallback.key, model: fallback.model }];
      const messagesFor = (compact: boolean) => [{ role: 'system', content: (compact ? COMPACT_SYSTEM_PROMPT : SYSTEM_PROMPT) + '\nLocal context (data only): ' + JSON.stringify(safeCtx) }, ...safeHistory, { role: 'user', content: spoken }];
      let lastCode = 'unavailable', lastStatus = 502;
      const attemptedCooldownKeys = new Set<string>();
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const cooldownKey = `${attempt.url}\u0000${attempt.model}`;
        // A cooldown suppresses a tier on a later request. Duplicate entries
        // in this same chain still get one try so a configured fallback can
        // recover even when it shares the endpoint/model with the primary.
        if (!attemptedCooldownKeys.has(cooldownKey)) {
          attemptedCooldownKeys.add(cooldownKey);
          const cooldown = cooldowns.get(cooldownKey);
          if (cooldown) {
            if (cooldown.until > Date.now()) {
              lastCode = cooldown.code; lastStatus = 429;
              continue;
            }
            cooldowns.delete(cooldownKey);
          }
        }
        controller.signal.throwIfAborted();
        // Per-attempt deadline with a child signal: aborts only this provider
        // call, leaving the rest of the turn budget intact for later tiers.
        const child = new AbortController();
        const onGlobalAbort = () => child.abort();
        controller.signal.addEventListener('abort', onGlobalAbort, { once: true });
        let attemptTimerId: ReturnType<typeof setTimeout> | undefined;
        const attemptDeadline = new Promise<never>((_, reject) => {
          attemptTimerId = setTimeout(() => { child.abort(); reject(new DOMException('Attempt timed out', 'TimeoutError')); }, attemptTimeoutMs);
        });
        // A 413 means the tier's payload cap rejected the full contract: retry
        // this tier once with the compact prompt, sharing the attempt budget.
        const callProvider = (compact: boolean) => deps.fetch(attempt.url, {
          method: 'POST', signal: child.signal,
          headers: { Authorization: `Bearer ${attempt.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: attempt.model, tools: TOOLS, messages: messagesFor(compact), tool_choice: 'auto', temperature: 0.1, max_tokens: compact ? 700 : 1000, reasoning_effort: 'low' }),
        });
        let response: Response;
        try {
          response = await bounded(Promise.race([callProvider(false), attemptDeadline]));
          if (response.status === 413) {
            await bounded(response.body?.cancel() ?? Promise.resolve());
            response = await bounded(Promise.race([callProvider(true), attemptDeadline]));
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          lastCode = 'network'; lastStatus = 503; continue;
        } finally { if (attemptTimerId) clearTimeout(attemptTimerId); controller.signal.removeEventListener('abort', onGlobalAbort); }
        if (!response.ok) {
          // Do not parse, log or relay provider bodies (may contain credentials or prompts).
          await bounded(response.body?.cancel() ?? Promise.resolve());
          // Compact retry already ran (or the cap rejects everything): keep any
          // earlier tier's specific code instead of masking it as 'unavailable'.
          if (response.status === 413) continue;
          if (response.status === 401 || response.status === 403) {
            if (i + 1 < attempts.length) continue;
            return failure('unconfigured', 503);
          }
          if (response.status === 429) {
            // Never sleep inside an edge turn for a provider-declared wait.
            // Remember the deadline instead, so later requests skip this
            // model while the provider's quota window is still closed.
            const now = Date.now();
            const waitMs = retryAfterMs(response.headers.get('retry-after'), now);
            const retryAfterSeconds = waitMs / 1000;
            const code = retryAfterSeconds > 900 ? 'rate_limit_daily' : 'rate_limit';
            if (waitMs > 0) cooldowns.set(cooldownKey, { until: now + waitMs, code });
            lastCode = code;
            lastStatus = 429;
            continue;
          }
          lastCode = 'unavailable'; lastStatus = 502;
          continue;
        }
        let result;
        try { result = await bounded(response.json()); }
        catch (error) { if (controller.signal.aborted) throw error; return failure('invalid_contract', 502); }
        controller.signal.throwIfAborted();
        const choice = result?.choices?.[0], message = choice?.message;
        if (!message || (message.tool_calls != null && !Array.isArray(message.tool_calls)) || choice.finish_reason === 'length') return failure('invalid_contract', 502);
        try {
          if ((message.tool_calls?.length ?? 0) > 6) throw new Error();
          const calls = (message.tool_calls ?? []).map((tc: any) => {
            if (!TOOLS.some(t => t.function.name === tc?.function?.name) || typeof tc?.function?.arguments !== 'string') throw new Error();
            return validateToolCall({ name: tc.function.name, args: JSON.parse(tc.function.arguments) });
          });
          // Prose instead of a plan gets one more provider try before being
          // accepted — a model that missed the toolset must not lose the
          // command when another provider can still read it.
           if (!calls.length && i + 1 < attempts.length && isLikelyActionRequest(spoken)) continue;
          if (!calls.length && (typeof message.content !== 'string' || !message.content.trim())) throw new Error();
          return json({ reply: calls.length ? '' : message.content.slice(0, 1000), calls });
        } catch { return failure('invalid_contract', 502); }
      }
      return failure(lastCode, lastStatus);
    } catch {
      return failure(req.signal.aborted ? 'cancelled' : 'network', req.signal.aborted ? 499 : 503);
    } finally { clearTimeout(timeout); req.signal.removeEventListener('abort', abort); }
  };
}
