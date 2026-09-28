// LifeOS — voice assistant runtime: wake word ("Hey LifeOS"), speech
// recognition, and command execution against the app's own db helpers.
//
// The Web Speech API is available in Chrome/Edge (desktop + Android WebView
// on most devices). Where it's missing, the mic button says so honestly.
// The wake-word listener runs only while the app is open (a background
// mic would need a native service — deliberately out of scope here).
import { parseCommand, matchesWakeWord, stripWakeWord } from './assistant';
import type { AssistantIntent } from './assistant';
import { createTask, createNote, createReminder, dbState } from './db';
import { todayStr } from './dates';
import { parseQuickAdd } from './quickadd';

// --- Speech recognition availability ---
type SR = any;
export function speechSupported(): boolean {
  return typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}
function getSR(): SR | null {
  return ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) ?? null;
}

// --- Settings (persisted locally) ---
export interface AssistantSettings {
  enabled: boolean;
  wakeWord: string;       // spoken phrase that arms the assistant
  listenContinuously: boolean;
}
const KEY = 'lifeos.assistant';
export function getAssistantSettings(): AssistantSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { enabled: false, wakeWord: 'hey lifeos', listenContinuously: true, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { enabled: false, wakeWord: 'hey lifeos', listenContinuously: true };
}
export function saveAssistantSettings(s: AssistantSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// --- Singleton recognizer with restart-on-end for continuous listening ---
let recog: SR | null = null;
let wantListening = false;
let onHeard: ((text: string, isFinal: boolean) => void) | null = null;
let onError: ((err: string) => void) | null = null;

function buildRecognizer(): SR | null {
  const Ctor = getSR();
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'en-US';
  r.onresult = (e: any) => {
    let final = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    if (final) onHeard?.(final.trim(), true);
    else if (interim) onHeard?.(interim.trim(), false);
  };
  r.onerror = (e: any) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantListening = false;
      onError?.('Microphone permission denied');
    } else if (e.error === 'no-speech' || e.error === 'aborted') {
      // benign in continuous mode
    } else {
      onError?.(e.error);
    }
  };
  r.onend = () => {
    // Continuous mode: Chrome ends sessions periodically — restart while wanted.
    if (wantListening) { try { r.start(); } catch { /* already started */ } }
  };
  return r;
}

export function startListening(
  heard: (text: string, isFinal: boolean) => void,
  err?: (e: string) => void,
): boolean {
  onHeard = heard;
  onError = err ?? null;
  wantListening = true;
  if (!recog) recog = buildRecognizer();
  if (!recog) return false;
  try { recog.start(); } catch { /* already running */ }
  return true;
}

export function stopListening(): void {
  wantListening = false;
  try { recog?.stop(); } catch { /* ignore */ }
}

export function isListening(): boolean { return wantListening; }

// --- Command execution: intents -> real writes through the app's db ---
export interface CommandResult { ok: boolean; message: string; intent: AssistantIntent; }

export async function executeCommand(
  spoken: string,
  ctx: { page: string; pageParams: Record<string, string>; navigate: (p: any, params?: Record<string, string>) => void },
): Promise<CommandResult> {
  const intent = parseCommand(spoken);

  switch (intent.kind) {
    case 'add_task': {
      // Context: adding from Calendar with a selected date presets the date.
      let presetDate = intent.presetDate;
      let presetTime = intent.presetTime;
      if (ctx.page === 'calendar' && !presetDate) {
        const cal = (window as any).__lifeosCalendarDate as string | undefined;
        if (cal) presetDate = cal;
      }
      const p = parseQuickAdd(intent.text);
      await createTask({
        title: p.title,
        due_date: presetDate ?? p.due_date ?? todayStr(),
        due_time: presetTime ?? p.due_time,
        priority: (intent.priority ?? p.priority ?? 'medium') as any,
        recurrence: p.recurrence,
        recurrence_days: p.recurrence_days,
        recurrence_anchor: presetDate ?? p.due_date ?? todayStr(),
      });
      return { ok: true, message: `Task added: ${p.title}`, intent };
    }
    case 'add_reminder': {
      const p = parseQuickAdd(intent.text);
      await createReminder({
        title: intent.text || p.title,
        due_at: intent.due_at ?? new Date(Date.now() + 3600_000).toISOString(),
        priority: (p.priority ?? 'medium') as any,
      });
      return { ok: true, message: `Reminder set: ${intent.text}`, intent };
    }
    case 'add_note': {
      await createNote({ title: intent.title.slice(0, 80) || 'Voice note', content: intent.content });
      return { ok: true, message: `Note added: ${intent.title}`, intent };
    }
    case 'navigate': {
      ctx.navigate(intent.page);
      return { ok: true, message: `Opened ${intent.page}`, intent };
    }
    case 'summarize_day': {
      const s = dbState();
      const today = todayStr();
      const tasks = s.tasks.filter((t) => !t.deleted && !t.archived && t.due_date === today && t.status !== 'completed');
      const rems = s.reminders.filter((r) => (r.due_at ?? '').slice(0, 10) === today);
      const parts = [`${tasks.length} task${tasks.length === 1 ? '' : 's'}`, `${rems.length} reminder${rems.length === 1 ? '' : 's'}`];
      const first = tasks.slice(0, 3).map((t) => t.title);
      const msg = `Today you have ${parts.join(' and ')}` + (first.length ? `. Next up: ${first.join(', ')}` : '');
      return { ok: true, message: msg, intent };
    }
    default:
      return { ok: false, message: "I didn't catch a command. Try \"add task…\", \"remind me to…\", \"open calendar\" or \"what's on my day\".", intent };
  }
}

// --- Wake-word pipeline: feed every final transcript through here ---
// Returns a command string when the wake word was heard (with the command
// text after it, or '' meaning "wake word alone — start listening for the
// command"). Returns null when the speech is unrelated.
export function extractWakeCommand(text: string, settings: AssistantSettings): string | null {
  const t = text.trim();
  if (!t) return null;
  if (matchesWakeWord(t, settings.wakeWord)) return stripWakeWord(t, settings.wakeWord);
  return null;
}
