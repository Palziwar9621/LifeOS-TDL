// LifeOS AI — offline intent engine for the voice assistant.
// Turns a spoken command like "add task submit assignment tomorrow at 5
// high priority" into a structured action. Runs fully on-device — no API
// keys, no network, works offline.
import { parseQuickAdd } from './quickadd';
import { stopIntent } from './assistantSafety';

export type AssistantIntent =
  | { kind: 'add_task'; text: string; presetDate?: string; presetTime?: string; priority?: string }
  | { kind: 'add_reminder'; text: string; due_at?: string }
  | { kind: 'add_note'; title: string; content: string }
  | { kind: 'complete_task' | 'reopen_task'; title_match: string }
  | { kind: 'delete_task' | 'delete_reminder' | 'delete_note'; title_match: string }
  | { kind: 'navigate'; page: string; tab?: 'notes' | 'ideas' | 'remember' }
  | { kind: 'summarize_day' | 'summarize_week' }
  | { kind: 'summarize_stats' }
  | { kind: 'search_all'; query: string }
  | { kind: 'stop'; mode: 'end' | 'interrupt' }
  | { kind: 'unknown'; text: string };

const PAGE_WORDS: Record<string, string> = {
  home: 'home', dashboard: 'home', today: 'today', tasks: 'tasks', task: 'tasks',
  calendar: 'calendar', routines: 'productivity', routine: 'productivity',
  productivity: 'productivity', projects: 'projects', goals: 'goals',
  notes: 'notes', note: 'notes', ideas: 'ideas', idea: 'ideas',
  reminders: 'reminders', reminder: 'reminders', stats: 'stats',
  statistics: 'stats', focus: 'focus', settings: 'settings', review: 'review',
};

const TIME_WORDS: Record<string, string> = {
  morning: '09:00', noon: '12:00', afternoon: '14:00', evening: '18:00',
  night: '21:00', midnight: '00:00',
};

/** Normalize a speech transcript into a parsable string:
 *  spell out digits ("7 pm" -> "7 pm" already fine; "seven pm" -> "7 pm"),
 *  lowercase, collapse spaces. */
function normalize(spoken: string): string {
  const num: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
    seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
    thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
    eighteen: '18', nineteen: '19', twenty: '20', 'twenty one': '21',
    'twenty two': '22', 'twenty three': '23', half: '30', quarter: '15',
  };
  let t = ' ' + spoken.toLowerCase().trim() + ' ';
  for (const [w, d] of Object.entries(num).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
  }
  return t.replace(/\s+/g, ' ').trim();
}

export function parseCommand(spoken: string): AssistantIntent {
  const stopping = stopIntent(spoken);
  if (stopping) return { kind: 'stop', mode: stopping };
  const t = normalize(spoken).replace(/[’]/g, "'").replace(/[.!?]+$/, '').trim()
    .replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/, '').replace(/\s+please$/, '');
  // Offline writes are deliberately single-intent. Do not discard a later
  // qualification, negation, hypothetical, or second requested action.
  if (/\b(?:don't|do not|never|instead|except|unless|if|but|and then|then)\b|\band\s+(?:add|create|delete|remove|mark|complete|move|open)\b/.test(t)) return { kind: 'unknown', text: spoken };

  // Keep destructive commands available offline too. The online brain has
  // richer matching, but the fallback must not turn "delete X" into an
  // unknown command when the network is unavailable.
  const deleteM = t.match(/^(?:delete|remove|erase)\s+(?:the\s+)?(task|note|reminder)\s+(.+)$/);
  if (deleteM) {
    const raw = deleteM[2].trim();
    if (/\b(?:and|but|except|all|every)\b/.test(raw)) return { kind: 'unknown', text: spoken };
    const kind = deleteM[1] === 'note' ? 'delete_note' : deleteM[1] === 'reminder' ? 'delete_reminder' : 'delete_task';
    return { kind, title_match: raw };
  }

  // Explicit completion/reopen phrasing is safe to execute locally because
  // the tool layer still requires one unique existing title.
  const reopenM = t.match(/^(?:reopen|untick|uncheck)\s+(?:the\s+)?task\s+(.+)$/)
    ?? t.match(/^mark\s+(?:the\s+)?task\s+(.+?)\s+(?:as\s+)?(?:not done|incomplete|open)$/);
  if (reopenM) return { kind: 'reopen_task', title_match: reopenM[1].trim() };
  const completeM = t.match(/^(?:finish|finished|complete|completed|tick\s+off|check\s+off)\s+(?:the\s+)?task\s+(.+)$/)
    ?? t.match(/^mark\s+(?:the\s+)?task\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed)$/);
  if (completeM) return { kind: 'complete_task', title_match: completeM[1].trim() };

  // "add note <title> about <body>" / "take a note ..."
  const noteM = t.match(/^(?:add|take|create|make|jot|scribble)\s+(?:down\s+)?(?:a\s+)?note\s+(.+)/);
  if (noteM) {
    const body = noteM[1];
    const aboutM = body.split(/\s+about\s+|\s+that\s+says\s+|\s+saying\s+/);
    return { kind: 'add_note', title: aboutM[0].trim(), content: (aboutM[1] ?? '').trim() };
  }

  // Require an explicit task request rather than treating "I want to ..."
  // conversation (or an indirect delete request) as permission to create.
  const naturalTaskM = t.match(/^add\s+(.+?)\s+to\s+my\s+(?:tasks|to-do list|todo list)$/);
  if (naturalTaskM && naturalTaskM[1].trim()) {
    const p = parseQuickAdd(naturalTaskM[1]);
    return { kind: 'add_task', text: naturalTaskM[1], presetDate: p.due_date ?? undefined, presetTime: p.due_time ?? undefined, priority: p.priority ?? undefined };
  }

  // "add task ..." / "remind me to ..." / "create reminder ..."
  const taskM = t.match(/^(?:add|create|new)\s+(?:a\s+)?task\s+(.+)/);
  if (taskM) {
    const p = parseQuickAdd(taskM[1]);
    const timeWord = Object.keys(TIME_WORDS).find((w) => ` ${taskM[1]} `.includes(` ${w} `));
    return {
      kind: 'add_task',
      text: taskM[1],
      presetDate: p.due_date ?? undefined,
      presetTime: p.due_time ?? (timeWord ? TIME_WORDS[timeWord] : undefined),
      priority: p.priority ?? undefined,
    };
  }

  const remindM = t.match(/^remind me (?:to |about )?(.+)/);
  if (remindM) {
    const p = parseQuickAdd(remindM[1]);
    const when = p.due_date && p.due_time
      ? new Date(`${p.due_date}T${p.due_time.slice(0, 5)}`).toISOString()
      : undefined;
    return { kind: 'add_reminder', text: p.title, due_at: when };
  }
  const remM = t.match(/^(?:add|create|new)\s+(?:a\s+)?reminder\s+(.+)/);
  if (remM) {
    const p = parseQuickAdd(remM[1]);
    const when = p.due_date && p.due_time
      ? new Date(`${p.due_date}T${p.due_time.slice(0, 5)}`).toISOString()
      : undefined;
    return { kind: 'add_reminder', text: p.title, due_at: when };
  }

  // "review my week" / "weekly recap"
  if (/\b(?:review|recap|summarize)\b.*\b(?:week|weekly)\b|\bweekly\s+(?:recap|review)\b/.test(t)) return { kind: 'summarize_week' };

  // "what's on my day" / "summarize my day"
  if (/\b(what('| i)?s|show|tell me).*(day|today|schedule|planned)\b/.test(t) || /\bsummarize\b/.test(t)) {
    return { kind: 'summarize_day' };
  }

  // "how am I doing" / "show my stats" / "my progress"
  if (/\b(how (?:am|did) (?:i|we) doing|my stats|statistics|my progress|completion rate)\b/.test(t)) {
    return { kind: 'summarize_stats' };
  }

  const searchM = t.match(/^(?:find|search(?:\s+for)?|where\s+is)\s+(.+?)(?:\s+anywhere)?$/);
  if (searchM && searchM[1].trim()) return { kind: 'search_all', query: searchM[1].trim() };

  const libraryM = t.match(/^(?:open|go to|show|switch to)\s+(?:my\s+)?(notes?|ideas?|remember(?: items?)?)$/);
  if (libraryM) {
    const tab = libraryM[1].startsWith('note') ? 'notes' : libraryM[1].startsWith('idea') ? 'ideas' : 'remember';
    return { kind: 'navigate', page: 'library', tab };
  }

  // "open calendar" / "go to tasks"
  const navM = t.match(/^(?:open|go to|show|switch to|take me to)\s+(?:(?:the|my)\s+)?(\w+)(?:\s+page)?$/);
  if (navM && PAGE_WORDS[navM[1]]) return { kind: 'navigate', page: PAGE_WORDS[navM[1]] };

  return { kind: 'unknown', text: spoken.trim() };
}

/** Wake-word check: "hey lifeos", "okay lifeos", or a custom phrase. */
export function matchesWakeWord(transcript: string, wakeWord: string): boolean {
  const t = transcript.trim().toLowerCase();
  const w = wakeWord.trim().toLowerCase();
  return !!w && t.startsWith(w) && (t.length === w.length || /^[\s,.!?]/.test(t.slice(w.length)));
}

/** Strip the wake word (and anything before it) so the rest is the command. */
export function stripWakeWord(transcript: string, wakeWord: string): string {
  if (!matchesWakeWord(transcript, wakeWord)) return transcript;
  return transcript.trim().slice(wakeWord.trim().length).replace(/^[\s,.!?]+/, '');
}
