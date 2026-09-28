// Supabase Edge Function: assistant
// Receives { spoken, ctx } from the app, calls Groq (llama-3.3-70b-versatile)
// with a strict tool schema, and returns { reply, calls }.
// Secrets: GROQ_API_KEY (set via `npx supabase secrets set GROQ_API_KEY=...`).
// Auth: requires a valid user access token (verify with SUPABASE_URL/keys).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Create a task. Use for anything the user wants to do. "Remind me to X" maps here when it is an action with a time.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short task title' },
          due_date: { type: 'string', description: 'yyyy-MM-dd, resolved from context.today' },
          due_time: { type: 'string', description: 'HH:mm 24h ("9 PM" -> 21:00)' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          remind_me: { type: 'boolean', description: 'true = alarm at task time (default when a time is given); false = silent' },
          reminder_minutes: { type: 'number', description: 'Minutes before due_time to ring; 0 = exactly at time' },
          project_hint: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Create a note for information without a deadline.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_reminder',
      description: 'Standalone timed reminder.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, due_at: { type: 'string', description: 'ISO datetime with tz offset' } }, required: ['title', 'due_at'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark an existing task completed by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete an existing task by title match. Only on explicit delete/remove requests.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: "Turn the alarm on/off for an EXISTING task ('remind me' / \"don't remind me\").",
      parameters: { type: 'object', properties: { title_match: { type: 'string' }, remind_me: { type: 'boolean' } }, required: ['title_match', 'remind_me'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Open a tab of the app.',
      parameters: { type: 'object', properties: { page: { type: 'string', enum: ['home', 'today', 'tasks', 'calendar', 'productivity', 'projects', 'goals', 'notes', 'ideas', 'reminders', 'stats', 'focus', 'review', 'settings'] } }, required: ['page'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Bring the app to the foreground (Android).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_day',
      description: 'Report today\'s plan.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const SYSTEM_PROMPT = `You are LifeOS Assistant, the built-in voice assistant of a personal productivity app.
The user speaks casual voice commands; convert them into tool calls using the provided context.

Rules:
- ctx.today and ctx.time are the user's local date/time — resolve "tomorrow", "tonight", "next monday" against them.
- Convert spoken times to 24h HH:mm ("9 PM" -> 21:00).
- Task with a specific time and no "don't remind": remind_me=true, reminder_minutes=0 (ring exactly at the time).
- "remind me about X": if X likely exists use set_reminder(true), else create with remind_me=true.
- "don't remind me about X": set_reminder(false).
- Prefer add_task for actions, add_note for information, add_reminder for pure time nudges.
- Prefer add_task for actions, add_note for information, add_reminder for pure time nudges.
- Act on the most reasonable interpretation; do not ask questions back.
- If nothing fits, return no tool call and a short spoken-style reply.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // Auth: accept a user JWT (verified) OR the service_role key (for
    // curl testing, same convention as the send-push function).
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey || token !== serviceKey) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: auth } } },
      );
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
    }

    const { spoken, ctx } = await req.json();
    if (!spoken || typeof spoken !== 'string') return new Response(JSON.stringify({ error: 'No spoken text' }), { status: 400, headers: cors });

    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) return new Response(JSON.stringify({ error: 'AI not configured (GROQ_API_KEY missing)' }), { status: 500, headers: cors });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\nCONTEXT: ' + JSON.stringify(ctx ?? {}) },
      { role: 'user', content: spoken },
    ];

    // Try the preferred model, fall back through Groq's catalog if it was
    // renamed/retired (prevents hard outages when Groq changes model IDs).
    const candidates = [MODEL, 'llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'gemma2-9b-it'];
    let res: Response | null = null;
    let lastErr = '';
    for (const model of candidates) {
      const r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.1, max_tokens: 500 }),
      });
      if (r.ok) { res = r; break; }
      lastErr = `${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (r.status === 401 || r.status === 429) break; // key/billing problem — no point trying other models
    }

    if (!res) {
      return new Response(JSON.stringify({ error: `AI error ${lastErr}` }), { status: 502, headers: cors });
    }

    const out = await res.json();
    const msg = out.choices?.[0]?.message ?? {};
    const calls: any[] = (msg.tool_calls ?? []).map((tc: any) => ({
      name: tc.function?.name,
      args: safeParse(tc.function?.arguments),
    }));
    return new Response(JSON.stringify({ reply: msg.content ?? '', calls }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});

function safeParse(s: string | undefined): Record<string, any> {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
