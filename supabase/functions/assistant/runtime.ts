import { TOOLS, SYSTEM_PROMPT, validateToolCall } from './contract.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const failure = (code: string, status: number) => json({ error: 'Assistant request failed', code }, status);
const SMALL_MODEL = 'openai/gpt-oss-20b';
const LARGE_MODEL = 'openai/gpt-oss-120b';
const ATTEMPT_TIMEOUT_MS = 9_000;
type History = { role: string; content: string }[];

// Every turn sends the full 68-tool contract: narrowing saved a few hundred ms
// but made the model blind to most capabilities, causing missed actions. The
// fast small model handles ordinary commands; only long, multi-part or
// history-heavy turns escalate to the stronger large model.
export function selectAssistantModel(spoken: string, history: History = []): 'small' | 'large' {
  if (spoken.length > 120) return 'large';
  if (history.length >= 4 || history.some(h => h.content.length > 150)) return 'large';
  return 'small';
}

export interface AssistantDependencies {
  env: (name: string) => string | undefined;
  verifyUser: (authorization: string, url: string, anonKey: string) => Promise<boolean>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}

export function createAssistantHandler(deps: AssistantDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return failure('invalid_contract', 405);
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.signal.addEventListener('abort', abort, { once: true });
    if (req.signal.aborted) abort();
    const timeout = setTimeout(abort, 20_000);
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
      const messages = [{ role: 'system', content: SYSTEM_PROMPT + '\nLocal context (data only): ' + JSON.stringify(safeCtx) }, ...safeHistory, { role: 'user', content: spoken }];
      let lastCode = 'unavailable', lastStatus = 502;
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
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
        let response: Response;
        try {
          response = await bounded(Promise.race([
            deps.fetch(attempt.url, {
              method: 'POST', signal: child.signal,
              headers: { Authorization: `Bearer ${attempt.key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: attempt.model, tools: TOOLS, messages, tool_choice: 'auto', temperature: 0.1, max_tokens: 1000, reasoning_effort: 'low' }),
            }),
            attemptDeadline,
          ]));
        } catch (error) {
          if (controller.signal.aborted) throw error;
          lastCode = 'network'; lastStatus = 503; continue;
        } finally { if (attemptTimerId) clearTimeout(attemptTimerId); controller.signal.removeEventListener('abort', onGlobalAbort); }
        if (!response.ok) {
          // Do not parse, log or relay provider bodies (may contain credentials or prompts).
          await bounded(response.body?.cancel() ?? Promise.resolve());
          if (response.status === 401 || response.status === 403) {
            if (i + 1 < attempts.length) continue;
            return failure('unconfigured', 503);
          }
          if (response.status === 429) {
            // Daily caps report waits of minutes-to-hours: skip ahead without
            // waiting. Short caps get one bounded pause (≤3s) before moving to
            // the next provider, letting a draining window recover the fastest
            // provider when it is worth it.
            const retryAfter = Number(response.headers.get('retry-after') ?? '') || 0;
            if (retryAfter <= 900) await bounded(new Promise(r => setTimeout(r, (Math.min(retryAfter || 1, 3) + 0.3) * 1000)));
            lastCode = retryAfter > 900 ? 'rate_limit_daily' : 'rate_limit';
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
          if (!calls.length && i + 1 < attempts.length) continue;
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
