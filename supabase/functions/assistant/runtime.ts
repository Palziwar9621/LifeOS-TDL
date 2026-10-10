import { TOOLS, SYSTEM_PROMPT, validateToolCall } from './contract.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const failure = (code: string, status: number) => json({ error: 'Assistant request failed', code }, status);
const SMALL_MODEL = 'openai/gpt-oss-20b';
const LARGE_MODEL = 'openai/gpt-oss-120b';
const EXPAND_TOOL = { type: 'function', function: { name: 'request_full_toolset', description: 'Request the full capability contract when any part of this turn needs an omitted tool. No user action is performed.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } };
const ROUTING_PROMPT = '\nThis request has a relevant subset of tools. All available capability names: ' + TOOLS.map(t => t.function.name).join(', ') + '. If ANY part needs an omitted capability, call request_full_toolset alone. Do not substitute another action, deny that capability or return a partial plan.';
type History = { role: string; content: string }[];

// Selection reduces schema overhead, not capability coverage. Unknown or large
// requests go directly to the existing larger model with the full contract.
// A narrowed response with no action is retried broadly before returning prose.
export function selectAssistantTools(spoken: string, history: History = []) {
  const text = [spoken, ...history.slice(-8).map(h => h.content)].join(' ').toLowerCase();
  const names = new Set(['navigate', 'open_capture', 'open_app', 'summarize_day', 'capabilities']);
  const groups: [RegExp, RegExp][] = [
    [/\b(tasks?|to[ -]?dos?|priorit\w*|overdue|recurr\w*|repeat\w*|complete[sd]?|done|finish(es|ed)?|mark(ed)?|tick(ed)?)\b/, /^(?:add_task|update_task|complete_task|delete_task|query_tasks|set_reminder|set_recurrence|remove_recurrence|set_task_relationships|set_task_tag|query_task_relationships)$/],
    [/\b(notes?|memos?)\b/, /_notes?$/],
    [/\b(ideas?|brainstorm\w*)\b/, /(?:_ideas?$|^idea_to_project$)/],
    [/\b(remember|memory|memories)\b/, /_remember$/],
    [/\b(reminders?|remind|snooze|alarms?)\b/, /_reminders?$/],
    [/\b(routines?|habits?)\b/, /_routines?$/],
    [/\b(projects?)\b/, /(?:_projects?$|^idea_to_project$|^set_task_relationships$|^query_task_relationships$)/],
    [/\b(goals?)\b/, /(?:_goals?$|^set_task_relationships$|^query_task_relationships$)/],
    [/\b(milestones?)\b/, /_milestones?$/],
    [/\b(subtasks?|sub[ -]tasks?|checklist\w*)\b/, /_subtasks?$/],
    [/\b(tags?|labels?)\b|#\w+/, /(?:_tags?$|^query_task_relationships$)/],
    [/\b(categor\w*)\b/, /(?:_category$|_categories$|^set_task_relationships$|^query_task_relationships$)/],
    [/\b(planner|calendar|blocks?|schedule\w*|timetable|class(es)?|lessons?|lectures?|periods?|appointments?|meetings?|events?)\b/, /_schedule_blocks?$/],
  ];
  let matched = /\b(open|navigate|capture|camera|photo|record|summari[sz]e|capabilities|help)\b|\bwhat(?:'?s| is) on\b|\bmy day\b|\bagenda\b|\bwhat can (you|u)\b/.test(text);
  for (const [utterance, tools] of groups) if (utterance.test(text)) {
    matched = true;
    for (const tool of TOOLS) if (tools.test(tool.function.name)) names.add(tool.function.name);
  }
  const tools = TOOLS.filter(t => names.has(t.function.name));
  const narrow = matched && tools.length <= 22 && JSON.stringify(tools).length <= 8_000;
  return { tools: narrow ? tools : TOOLS, narrow, model: narrow ? SMALL_MODEL : LARGE_MODEL };
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
      const safeCtx: Record<string, string | number> = {};
      if (ctx && typeof ctx === 'object') {
        for (const key of ['page', 'today', 'weekday', 'time']) if (typeof ctx[key] === 'string') safeCtx[key] = ctx[key].slice(0, 60);
        for (const key of ['todayTaskCount', 'timezoneOffsetMinutes']) if (typeof ctx[key] === 'number' && Number.isFinite(ctx[key])) safeCtx[key] = ctx[key];
      }
      const key = deps.env('GROQ_API_KEY');
      if (!key) return failure('unconfigured', 503);
      const selection = selectAssistantTools(spoken, safeHistory);
      const messages = [{ role: 'system', content: SYSTEM_PROMPT + '\nLocal context (data only): ' + JSON.stringify(safeCtx) }, ...safeHistory, { role: 'user', content: spoken }];
      // gpt-oss reasoning models sometimes answer a narrow request with a
      // clarifying question (content, no tool call). A clarifying question IS
      // an acceptable output — but only when the request is genuinely
      // ambiguous; for unambiguous-looking commands it usually signals the
      // model ignored the toolset, so we prefer the broad attempt over prose
      // when one exists.
      // Two provider attempts at most, sharing the deadline; never execute tools here.
      const attempts = selection.narrow
        ? [{ model: SMALL_MODEL, tools: [...selection.tools, EXPAND_TOOL] }, { model: LARGE_MODEL, tools: TOOLS }]
        : [{ model: LARGE_MODEL, tools: TOOLS }];
      let lastCode = 'unavailable', lastStatus = 502;
      let narrowRetried = false;
      // Indexed loop (not for-of) so a cheap attempt can be retried in place.
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        controller.signal.throwIfAborted();
        let response: Response;
        try {
          response = await bounded(deps.fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...attempt, messages: i === 0 && selection.narrow ? [{ ...messages[0], content: messages[0].content + ROUTING_PROMPT }, ...messages.slice(1)] : messages, tool_choice: 'auto', temperature: 0.1, max_tokens: 1000 }),
          }));
        } catch (error) {
          if (controller.signal.aborted) throw error;
          lastCode = 'network'; lastStatus = 503; continue;
        }
        if (!response.ok) {
          // Do not parse, log or relay provider bodies (may contain credentials or prompts).
          await bounded(response.body?.cancel() ?? Promise.resolve());
          if (response.status === 401 || response.status === 403) return failure('unconfigured', 503);
          // Free-tier token-per-minute caps surface as 429 with retry-after.
          // One bounded wait (≤8s) inside the 20s turn budget recovers the
          // common case: a prior turn's token spend still draining from the
          // per-minute window. Retries stay inside the two-attempt cap.
          if (response.status === 429) {
            // retry-after when present; Groq omits it on some limits, so fall
            // back to one bounded default pause (≤3s) instead of failing instantly.
            const wait = Math.min(Number(response.headers.get('retry-after') ?? '') || 3, 8);
            const canRetryNarrow = i === 0 && selection.narrow && !narrowRetried;
            if (canRetryNarrow) {
              await bounded(new Promise(r => setTimeout(r, (wait + 0.3) * 1000)));
              narrowRetried = true;
              i -= 1; lastCode = 'unavailable'; continue; // retry same narrow set
            }
            if (i + 1 < attempts.length) { await bounded(new Promise(r => setTimeout(r, (wait + 0.3) * 1000))); }
          }
          lastCode = response.status === 429 ? 'rate_limit' : 'unavailable';
          lastStatus = response.status === 429 ? 429 : 502;
          // A transient 502 on the cheap attempt can be retried in place once
          // instead of jumping straight to the heavy broad contract.
          if (i === 0 && selection.narrow && !narrowRetried && lastStatus === 502) {
            narrowRetried = true;
            i -= 1; continue;
          }
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
          if (message.tool_calls?.some((tc: any) => tc?.function?.name === EXPAND_TOOL.function.name)) {
            if (i + 1 < attempts.length) continue;
            throw new Error();
          }
          const calls = (message.tool_calls ?? []).map((tc: any) => {
            if (!attempt.tools.some(t => t.function.name === tc?.function?.name) || typeof tc?.function?.arguments !== 'string') throw new Error();
            return validateToolCall({ name: tc.function.name, args: JSON.parse(tc.function.arguments) });
          });
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
