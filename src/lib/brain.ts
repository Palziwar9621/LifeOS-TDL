// LifeOS AI — assistant brain via Groq (llama-3.3-70b) with function calling.
//
// The user's free-form speech is turned into precise app actions here. The
// model gets the app's live context (current page, today's date, projects,
// categories, existing tasks) and a strict tool schema, and MUST answer with
// tool calls — never free text injected anywhere.
//
// The Groq key lives in Supabase secrets (set once with the CLI); the web
// app calls this Edge Function with the user's auth token — no key in the
// client, ever.
import { getClient } from './supabase';
import { currentUserId } from './db';

export interface AppContext {
  page: string;
  pageParams: Record<string, string>;
  today: string;               // yyyy-MM-dd (device-local)
  weekday: string;
  time: string;                // HH:mm (device-local)
  projects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  recentTaskTitles: string[];
  todayTaskCount: number;
  routines: string[];
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Create a task. Use for anything the user wants to do/have done. "Remind me to X" also maps here when it is an action with a time.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short task title, e.g. "Dinner reservation"' },
          due_date: { type: 'string', description: 'yyyy-MM-dd. Resolve relative words (tomorrow, next friday) against the provided today/weekday.' },
          due_time: { type: 'string', description: 'HH:mm 24h. Convert spoken times like "9 PM" to 21:00.' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          remind_me: { type: 'boolean', description: 'true = alarm rings at the task time; false = silent task. Default true when a time is given.' },
          reminder_minutes: { type: 'number', description: 'Minutes before due_time to ring. 0 = ring exactly at the time.' },
          project_hint: { type: 'string', description: 'Project name from context if the user mentioned one.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Create a note. Use for information to remember that is not an action with a deadline.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_reminder',
      description: 'Create a standalone timed reminder (bell icon, not a task).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          due_at: { type: 'string', description: 'ISO datetime with timezone offset, e.g. 2026-01-05T21:00:00+05:30' },
        },
        required: ['title', 'due_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark a task completed by matching its title against recentTaskTitles/context.',
      parameters: {
        type: 'object',
        properties: { title_match: { type: 'string', description: 'Task title (or clear part of it) to complete' } },
        required: ['title_match'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete a task by title match. Confirm-hungry: only call when the user clearly asked to delete/remove.',
      parameters: {
        type: 'object',
        properties: { title_match: { type: 'string' } },
        required: ['title_match'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Turn the alarm on or off for an EXISTING task (remind me / don\'t remind me about X).',
      parameters: {
        type: 'object',
        properties: {
          title_match: { type: 'string' },
          remind_me: { type: 'boolean' },
        },
        required: ['title_match', 'remind_me'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Open a tab/section of the app.',
      parameters: {
        type: 'object',
        properties: { page: { type: 'string', enum: ['home', 'today', 'tasks', 'calendar', 'productivity', 'projects', 'goals', 'notes', 'ideas', 'reminders', 'stats', 'focus', 'review', 'settings'] } },
        required: ['page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Bring the LifeOS app to the foreground (Android). Use when the user says "open the app" from the background listener.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_day',
      description: 'Report what is planned for today.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const SYSTEM_PROMPT = `You are LifeOS Assistant, the built-in voice assistant of a personal productivity app.
The user speaks casual commands; you convert them into tool calls using the provided context.

Rules:
- "today" and current time are given in the user's timezone — resolve "tomorrow", "tonight", "next monday" against them.
- Convert spoken times to 24h HH:mm ("9 PM" -> 21:00, "7:45" in the morning -> 07:45).
- If a task has a specific time and the user didn't say "don't remind", set remind_me=true and reminder_minutes=0 (ring exactly at the time).
- "remind me about X" = ensure the alarm is ON for X (set_reminder) if X exists, otherwise create it with remind_me=true.
- "don't remind me about X" = set_reminder(false).
- Prefer add_task for actions, add_note for information, add_reminder for pure time-based nudges.
- If the request is ambiguous but you can make a reasonable interpretation, act — do not ask questions back (the interface is voice-only, one shot).
- If nothing fits, return no tool call; instead the user sees a help hint.`;

export async function askBrain(
  spoken: string,
  ctx: AppContext,
): Promise<{ reply: string; calls: ToolCall[] }> {
  const sb = getClient();
  const uid = currentUserId();
  if (!sb || !uid) return { reply: 'Not signed in', calls: [] };

  const { data, error } = await sb.functions.invoke('assistant', {
    body: { spoken, ctx },
  });
  if (error) throw new Error(error.message || 'Assistant service error');

  // Edge function returns { reply, calls } or { error }
  if ((data as any)?.error) throw new Error((data as any).error);
  return {
    reply: (data as any)?.reply ?? '',
    calls: (data as any)?.calls ?? [],
  };
}

export { TOOLS, SYSTEM_PROMPT };
