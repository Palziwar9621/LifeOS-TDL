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
  // ---------- Tasks ----------
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
      description: 'Change an EXISTING task: reschedule to another date/time, change priority, or rename. Use for "move X to friday", "reschedule X to 6pm", "make X urgent".',
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
  // ---------- Notes ----------
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
      name: 'delete_note',
      description: 'Delete a note by title match.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  // ---------- Standalone reminders ----------
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
          recurrence: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'], description: 'Optional repeat rule.' },
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
  // ---------- Ideas (Library → Ideas) ----------
  {
    type: 'function',
    function: {
      name: 'add_idea',
      description: 'Save an idea / someday-maybe thought into Library → Ideas.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', description: 'Optional details about the idea.' },
        },
        required: ['title'],
      },
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
      description: 'Convert an existing idea into an active project ("turn my mural idea into a project").',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_capture',
      description: 'Open the idea-capture modal where the user can add an idea with the CAMERA or a voice/text note. Use when the user says "capture an idea", "new idea with photo", "add idea with camera".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ---------- Projects & goals ----------
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a project to group tasks under (e.g. "create a project called Renovation").',
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
      description: 'Create a goal ("set a goal to run a marathon").',
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
  // ---------- Remember items (Library → Remember) ----------
  {
    type: 'function',
    function: {
      name: 'add_remember',
      description: 'Save a thing to remember (birthday, pin, fact) into Library → Remember.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'Optional details.' },
        },
        required: ['title'],
      },
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
  // ---------- Navigation ----------
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Open a tab/section of the app. Use "library" plus a subtab for notes/ideas/remember sections.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: ['home', 'today', 'tasks', 'calendar', 'productivity', 'projects', 'goals', 'library', 'notes', 'ideas', 'remember', 'reminders', 'stats', 'focus', 'review', 'search', 'settings'] },
          tab: { type: 'string', enum: ['notes', 'ideas', 'remember'], description: 'When page is library: which subtab to open.' },
        },
        required: ['page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_routine',
      description: 'Create a repeating routine in the Productivity tab. Use when the user says something repeats ("gym every mon,wed,fri"). For one-off to-dos use add_task.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          days: { type: 'array', items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] }, description: 'Weekdays 0=Sunday..6=Saturday.' },
          extra_date: { type: 'string', description: 'yyyy-MM-dd for a one-off routine.' },
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
      description: 'Delete a repeating routine by title match. Explicit deletes only.',
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

const SYSTEM_PROMPT = `You are LifeOS Assistant, the built-in VOICE assistant of a personal productivity app — like a human helper sitting next to the user. Talk naturally, briefly, and warmly, the way a person would.

You can CHAT and you can ACT — and you have FULL control of the app:
- Tasks (add/complete/delete/reschedule/reprioritize), notes, standalone reminders, ideas, remember-items, projects, goals — you manage every section.
- You can navigate anywhere: "open my notes", "show ideas", "go to the calendar" — use navigate. For Library sections pass page=library with tab=notes|ideas|remember.
- "Capture an idea with camera/photo" → open_capture (the app opens the camera capture flow).
- Small talk, questions about yourself, or general conversation: just reply in natural spoken language. Keep it to 1-2 short sentences a person would actually say out loud.
- Questions about the user's data ("what's on friday", "when is my exam", "what did I plan today"): call query_tasks (or summarize_day) and ANSWER with the results in natural speech — like telling a friend, not like reading a table.
- Commands to do something: call the right tool, then your spoken reply confirms it briefly and naturally ("Done — gym at 6 tomorrow, alarm set.").

Rules:
- ctx.today and ctx.time are the user's local date/time — resolve "tomorrow", "tonight", "next monday" against them.
- Convert spoken times to 24h HH:mm ("9 PM" -> 21:00).
- Task with a specific time and no "don't remind": remind_me=true, reminder_minutes=0 (ring exactly at the time).
- "remind me about X": if X likely exists use set_reminder(true), else create with remind_me=true.
- "don't remind me about X": set_reminder(false).
- Prefer add_task for actions, add_note for information, add_reminder for pure time nudges.
- Deletes are explicit-only: call delete_* tools only when the user clearly asked to remove something.
- Use the conversation history so follow-ups make sense: if the user says "move it to friday" or "and add milk too", resolve "it" and "also" from what was just discussed.
- Your reply is SPOKEN OUT LOUD: no markdown, no lists, no emoji, no stage directions — plain conversational sentences.
- If you genuinely can't help, say so briefly in a human way and suggest what you CAN do.`;

export async function askBrain(
  spoken: string,
  ctx: AppContext,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<{ reply: string; calls: ToolCall[] }> {
  const sb = getClient();
  const uid = currentUserId();
  if (!sb || !uid) return { reply: 'Not signed in', calls: [] };

  const { data, error } = await sb.functions.invoke('assistant', {
    body: { spoken, ctx, history: history.slice(-8) },
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
