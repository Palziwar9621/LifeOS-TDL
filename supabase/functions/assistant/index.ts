// Supabase Edge Function: assistant
// Receives { spoken, ctx } from the app, calls Groq with a strict tool
// schema, and returns { reply, calls }.
// Secrets: GROQ_API_KEY (set via `npx supabase secrets set GROQ_API_KEY=...`).
// Auth: requires a valid user access token (verify with SUPABASE_URL/keys).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Fast-first: llama-3.1-8b-instant answers in a fraction of the 70B's time —
// tool-calling quality for these ~30 simple tools is comparable, and voice UX
// cares about latency. 70B stays as the fallback for hard turns.
const MODEL = 'llama-3.1-8b-instant';

// Keep in sync with src/lib/brain.ts — the assistant has FULL app control:
// tasks, notes, reminders, ideas, remember-items, projects, goals, nav.
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
      name: 'query_tasks',
      description: 'Look up the user\'s tasks to answer questions like "what do I have on Friday", "when is my dentist appointment", "how many tasks are overdue". Returns matching tasks with dates/times/status.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Optional yyyy-MM-dd filter (resolved from context.today)' },
          date_range: { type: 'string', enum: ['today', 'tomorrow', 'this_week', 'overdue', 'all'] },
          title_contains: { type: 'string', description: 'Optional text to match in task titles' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Change an EXISTING task: reschedule, reprioritize, or rename. Use for "move X to friday", "reschedule X to 6pm", "make X urgent".',
      parameters: {
        type: 'object',
        properties: {
          title_match: { type: 'string', description: 'Task title (or clear part of it) to change' },
          due_date: { type: 'string', description: 'New yyyy-MM-dd, if changing date' },
          due_time: { type: 'string', description: 'New HH:mm 24h, if changing time' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          new_title: { type: 'string' },
        },
        required: ['title_match'],
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
      name: 'delete_note',
      description: 'Delete a note by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_reminder',
      description: 'Standalone timed reminder.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          due_at: { type: 'string', description: 'ISO datetime with tz offset' },
          recurrence: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] },
        },
        required: ['title', 'due_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_reminder',
      description: 'Delete a standalone reminder by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_idea',
      description: 'Save an idea / someday-maybe thought into Library → Ideas.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_idea',
      description: 'Delete an idea by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'idea_to_project',
      description: 'Convert an existing idea into an active project.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_capture',
      description: 'Open the idea-capture modal (camera photo + voice/text note). Use for "capture an idea", "new idea with camera/photo".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a project to group tasks under.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: 'Delete a project by name match. Tasks are kept but unlinked.',
      parameters: { type: 'object', properties: { name_match: { type: 'string' } }, required: ['name_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_goal',
      description: 'Create a goal.',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_goal',
      description: 'Delete a goal by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_remember',
      description: 'Save a thing to remember (birthday, pin, fact) into Library → Remember.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_remember',
      description: 'Delete a remember-item by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Open a tab of the app. For Library sections use page=library with tab=notes|ideas|remember.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: ['home', 'today', 'tasks', 'calendar', 'productivity', 'projects', 'goals', 'library', 'notes', 'ideas', 'remember', 'reminders', 'stats', 'focus', 'review', 'search', 'settings'] },
          tab: { type: 'string', enum: ['notes', 'ideas', 'remember'] },
        },
        required: ['page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_routine',
      description: 'Create a repeating routine in the Productivity tab (daily habits, gym days, chores with a fixed schedule). Use when the user says something repeats — "gym every mon,wed,fri", "meditate daily at 7am". For one-off to-dos use add_task instead.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          days: { type: 'array', items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] }, description: 'Weekdays 0=Sunday..6=Saturday. Every day = [0,1,2,3,4,5,6]; empty/omitted with extra_date = one-off.' },
          extra_date: { type: 'string', description: 'yyyy-MM-dd for a one-off routine on a specific date.' },
          time_of_day: { type: 'string', description: 'HH:mm 24h, optional.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_routine',
      description: 'Delete a repeating routine from the Productivity tab by title match. Explicit deletes only.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_routines',
      description: 'List the user\'s routines (Productivity tab).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ---------- Milestones (projects & goals) ----------
  {
    type: 'function',
    function: {
      name: 'add_milestone',
      description: 'Add a milestone to an existing PROJECT ("add a milestone: design sign-off to the renovation project") or GOAL. Use scope to pick which.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['project', 'goal'] },
          name_match: { type: 'string', description: 'Project or goal name (or clear part of it)' },
          title: { type: 'string', description: 'Milestone name, rephrased cleanly' },
          due_date: { type: 'string', description: 'Optional yyyy-MM-dd deadline for the milestone.' },
        },
        required: ['scope', 'name_match', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_milestone',
      description: 'Mark an existing milestone done by its title.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['project', 'goal'] },
          name_match: { type: 'string', description: 'Project/goal name' },
          title_match: { type: 'string', description: 'Milestone title (or clear part of it)' },
        },
        required: ['scope', 'name_match', 'title_match'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_milestone',
      description: 'Delete an existing milestone by title. Explicit deletes only.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['project', 'goal'] },
          name_match: { type: 'string' },
          title_match: { type: 'string' },
        },
        required: ['scope', 'name_match', 'title_match'],
      },
    },
  },
  // ---------- Recurrence on tasks ----------
  {
    type: 'function',
    function: {
      name: 'set_recurrence',
      description: 'Make an EXISTING task recurring ("make laundry repeat daily", "trash every tuesday").',
      parameters: {
        type: 'object',
        properties: {
          title_match: { type: 'string' },
          rule: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] },
          days: { type: 'array', items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] }, description: 'For weekly: which weekdays (0=Sun..6=Sat).' },
        },
        required: ['title_match', 'rule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_recurrence',
      description: 'Turn a recurring task back into a one-off.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
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

const SYSTEM_PROMPT = `You are LifeOS Assistant, the built-in VOICE assistant of a personal productivity app — like a human helper sitting next to the user. Talk naturally, briefly, and warmly, the way a person would.

## UNDERSTANDING THE USER (crucial — speech is messy)
The user's text often comes from imperfect speech recognition: misheard words, missing punctuation, broken grammar, filler words, or half-sentences. YOU are the layer that turns that mess into clean intent:
- Interpret INTENT, not exact words. "remnd me py bill tomo 5" = "remind me to pay the bill tomorrow at 5". "dinner at 8 with sam at ob_ori" = dinner reservation, 8pm, place Obori (fix obvious phonetic garbles into plausible real words).
- NEVER ask the user to repeat or say things verbatim. Your job is to GUESS the best interpretation and act on it. If it's genuinely ambiguous between two very different actions, pick the more likely one and say what you did in your reply — the user can correct you in the next sentence.
- REPHRASE titles cleanly: turn spoken rambling into a short proper task title ("um yeah i need to remember to call the dentist place tomorrow around like 2 to book a cleaning" → add_task(title="Call dentist to book cleaning", due_date=tomorrow, due_time=14:00)).
- Fill in missing pieces from context (history, current page, time of day).

## WHAT YOU CAN DO
You can CHAT and you can ACT — and you have FULL control of the app:
- Tasks (add/complete/delete/reschedule/reprioritize, set recurrences), notes, standalone reminders, ideas, remember-items, projects, goals and their MILESTONES — you manage every section.
- Routines (the Productivity tab, repeating habits): add_routine / delete_routine / query_routines. On the Productivity tab or with a repeating schedule → routine tools, NOT add_task.
- Navigate anywhere: "open my notes" → navigate (Library sections: page=library with tab=notes|ideas|remember).
- "Capture an idea with camera/photo" → open_capture.
- Small talk, questions about yourself, or general conversation: just reply in natural spoken language. Keep it to 1-2 short sentences a person would actually say out loud.
- Questions about the user's data ("what's on friday", "when is my exam"): call query_tasks (or summarize_day) and ANSWER with the results in natural speech — like telling a friend, not like reading a table.
- Commands to do something: call the right tool, then your spoken reply confirms it briefly and naturally ("Done — gym at 6 tomorrow, alarm set.").

## RULES
- ctx.today and ctx.time are the user's local date/time — resolve "tomorrow", "tonight", "next monday" against them.
- Convert spoken times to 24h HH:mm ("9 PM" -> 21:00, "half past six" -> 18:30, "quarter to five" -> 16:45).
- Task with a specific time and no "don't remind": remind_me=true, reminder_minutes=0 (ring exactly at the time).
- "remind me about X": if X likely exists use set_reminder(true), else create with remind_me=true.
- "don't remind me about X": set_reminder(false).
- "interrupt / stop / wait": this sentence may have arrived mid-previous-reply; treat it as the user REPLACING what they said before — act on the newest instruction without referencing the old one.
- Prefer add_task for actions, add_note for information, add_reminder for pure time nudges.
- Milestones: "add milestone X to project Y" → add_milestone(scope=project, name_match=Y, title=X).
- Recurring: "make X repeat daily/every monday" → set_recurrence; "stop X repeating" → remove_recurrence.
- Deletes are explicit-only: call delete_* tools only when the user clearly asked to remove something.
- Use the conversation history so follow-ups make sense: "move it to friday", "and add milk too" resolve "it"/"also" from what was just discussed.
- Your reply is SPOKEN OUT LOUD: no markdown, no lists, no emoji, no stage directions — plain conversational sentences, ideally under 20 words.
- If you genuinely can't help, say so briefly in a human way and suggest what you CAN do.`;

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

    const { spoken, ctx, history } = await req.json();
    if (!spoken || typeof spoken !== 'string') return new Response(JSON.stringify({ error: 'No spoken text' }), { status: 400, headers: cors });
    if (spoken.length > 500) return new Response(JSON.stringify({ error: 'Command too long' }), { status: 400, headers: cors });
    // Conversation history: last 8 turns, sanitized the same way as ctx.
    const safeHistory: { role: string; content: string }[] = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-8)) {
        if (h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') {
          safeHistory.push({ role: h.role, content: h.content.slice(0, 300) });
        }
      }
    }
    // Context minimization: cap each list so an oversized/compromised client
    // can't balloon the prompt (defense-in-depth alongside client trimming).
    const safeCtx: Record<string, unknown> = {};
    if (ctx && typeof ctx === 'object') {
      for (const [k, v] of Object.entries(ctx)) {
        if (Array.isArray(v)) safeCtx[k] = v.slice(0, 20);
        else if (typeof v === 'string' && v.length <= 200) safeCtx[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') safeCtx[k] = v;
        // objects/unknown types dropped (pageParams etc.)
      }
    }

    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) return new Response(JSON.stringify({ error: 'AI not configured (GROQ_API_KEY missing)' }), { status: 500, headers: cors });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\nCONTEXT: ' + JSON.stringify(safeCtx) },
      ...safeHistory,
      { role: 'user', content: spoken },
    ];

    // Try the preferred model, fall back through Groq's catalog if it was
    // renamed/retired (prevents hard outages when Groq changes model IDs).
    const candidates = [MODEL, 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'gemma2-9b-it'];
    let res: Response | null = null;
    let lastErr = '';
    for (const model of candidates) {
      const r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.15, max_tokens: 700 }),
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
