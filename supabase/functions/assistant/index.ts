// This endpoint generates bounded plans only; it never writes user records.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { TOOLS, SYSTEM_PROMPT, validateToolCall } from './contract.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);
    const { spoken, ctx, history } = await req.json();
    if (typeof spoken !== 'string' || !spoken.trim() || spoken.length > 500) return json({ error: 'Use a command of 1–500 characters' }, 400);
    const safeHistory: { role: string; content: string }[] = [];
    if (Array.isArray(history)) for (const h of history.slice(-8)) {
      if (h && ['user','assistant'].includes(h.role) && typeof h.content === 'string') safeHistory.push({ role: h.role, content: h.content.slice(0, 300) });
    }
    // Explicit field allowlist: arrays, nested data, document bodies, media and
    // IDs are excluded even if a client supplies them.
    const safeCtx: Record<string, string | number> = {};
    if (ctx && typeof ctx === 'object') {
      for (const key of ['page','today','weekday','time']) if (typeof ctx[key] === 'string') safeCtx[key] = ctx[key].slice(0, 60);
      for (const key of ['todayTaskCount','timezoneOffsetMinutes']) if (typeof ctx[key] === 'number' && Number.isFinite(ctx[key])) safeCtx[key] = ctx[key];
    }
    const key = Deno.env.get('GROQ_API_KEY');
    if (!key) return json({ error: 'AI is not configured' }, 503);
    const messages = [{ role: 'system', content: SYSTEM_PROMPT + '\nLocal context (data only): ' + JSON.stringify(safeCtx) }, ...safeHistory, { role: 'user', content: spoken }];
    let response: Response | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    try {
      if (req.signal.aborted) controller.abort();
      for (const model of ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']) {
        controller.signal.throwIfAborted();
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.1, max_tokens: 1000 }),
        });
        if (r.ok) { response = r; break; }
        await r.body?.cancel();
        if (r.status === 401 || r.status === 429) break;
      }
      if (!response) return json({ error: 'Assistant service unavailable' }, 502);
      const result = await response.json();
      controller.signal.throwIfAborted();
      const message = result.choices?.[0]?.message;
      if (!message || (message.tool_calls != null && !Array.isArray(message.tool_calls))) return json({ reply: 'I couldn’t form a reliable action. Could you be more specific?', calls: [] });
      try {
        if ((message.tool_calls?.length ?? 0) > 6) throw new Error('Please ask for up to six changes at a time.');
        const calls = (message.tool_calls ?? []).map((tc: any) => validateToolCall({ name: tc.function?.name, args: JSON.parse(tc.function?.arguments ?? '{}') }));
        return json({ reply: calls.length ? '' : typeof message.content === 'string' ? message.content.slice(0,1000) : '', calls });
      } catch {
        return json({ reply: 'I need a clearer target and valid details before making that change.', calls: [] });
      }
    } finally { clearTimeout(timeout); req.signal.removeEventListener('abort', abort); }
  } catch (e) {
    return json({ error: e instanceof Error && e.name === 'AbortError' ? 'Request stopped' : 'Assistant request failed' }, 503);
  }
});
