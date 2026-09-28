// LifeOS — voice assistant runtime (rebuilt sequentially).
//
// Pipeline: speech (web API or Android native bridge) → text →
//   1. Groq brain (Supabase Edge Function `assistant`) with full app context
//      → tool calls (add_task / add_note / add_reminder / complete_task /
//        delete_task / set_reminder / navigate / open_app / summarize_day)
//   2. Offline fallback parser (assistant.ts) when network/edge fails.
//
// Executes tool calls against the app's own db helpers, so every write is
// a normal LifeOS record: synced to Supabase, alarmed natively, visible
// everywhere.
import { parseCommand } from './assistant';
import type { AssistantIntent } from './assistant';
import { askBrain, type AppContext, type ToolCall } from './brain';
import { createTask, createNote, createReminder, updateTask, deleteTask, dbState, getSettings } from './db';
import { todayStr } from './dates';
import { parseQuickAdd } from './quickadd';

// --- Speech recognition availability ---
// Web Speech API (Chrome/Edge) OR the Android shell's native bridge
// (window.LifeOSSpeech — the WebView has no Web Speech API of its own).
type SR = any;
export function nativeSpeech(): any | null {
  return typeof window !== 'undefined' ? (window as any).LifeOSSpeech ?? null : null;
}
export function speechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || nativeSpeech());
}

// --- Settings (persisted locally) ---
export interface AssistantSettings {
  enabled: boolean;
  wakeWord: string;
  listenContinuously: boolean;
  useAI: boolean;          // true = Groq brain, false = offline parser only
}
const KEY = 'lifeos.assistant';
export function getAssistantSettings(): AssistantSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { enabled: false, wakeWord: 'hey lifeos', listenContinuously: true, useAI: true, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { enabled: false, wakeWord: 'hey lifeos', listenContinuously: true, useAI: true };
}
export function saveAssistantSettings(s: AssistantSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// --- Recognizer plumbing (web + native) ---
let recog: SR | null = null;
let wantListening = false;
let onHeard: ((text: string, isFinal: boolean) => void) | null = null;
let onError: ((err: string) => void) | null = null;

function nativeResult(text: string) { onHeard?.(text, true); }
function nativePartial(text: string) { onHeard?.(text, false); }
function nativeError(code: string) {
  if (code === '6' || code === '7' || code === 'no_match' || code === '8' || code === 'busy') return;
  if (code === 'not_available' || code === 'exception') onError?.('Speech recognition not available on this device');
  else if (code === '9' || code === '10') onError?.('Microphone permission denied');
  else onError?.('Speech error ' + code);
}

export function installNativeSpeech(): void {
  const n = nativeSpeech();
  if (!n || typeof window === 'undefined') return;
  (window as any).__lifeosSpeech = {
    onSpeechResult: nativeResult,
    onSpeechPartial: nativePartial,
    onSpeechError: nativeError,
    onSpeechReady: () => { /* armed */ },
  };
}

function buildRecognizer(): SR | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
  const n = nativeSpeech();
  if (n && typeof n.startContinuous === 'function') {
    installNativeSpeech();
    try { n.startContinuous(); return true; } catch { /* fall through */ }
  }
  if (!recog) recog = buildRecognizer();
  if (!recog) return false;
  try { recog.start(); } catch { /* already running */ }
  return true;
}

export function stopListening(): void {
  wantListening = false;
  const n = nativeSpeech();
  if (n && typeof n.stopContinuous === 'function') { try { n.stopContinuous(); } catch { /* ignore */ } }
  try { recog?.stop(); } catch { /* ignore */ }
}

export function isListening(): boolean { return wantListening; }

// --- Context for the brain ---
export function buildAppContext(page: string, pageParams: Record<string, string>): AppContext {
  const s = dbState();
  const now = new Date();
  return {
    page,
    pageParams,
    today: todayStr(),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    projects: s.projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name })),
    categories: s.categories.map((c) => ({ id: c.id, name: c.name })),
    recentTaskTitles: s.tasks.filter((t) => !t.deleted && !t.archived).slice(-15).map((t) => t.title),
    todayTaskCount: s.tasks.filter((t) => !t.deleted && t.due_date === todayStr() && t.status !== 'completed').length,
    routines: (s.routine_tasks ?? []).filter((r) => !r.archived).map((r) => r.title),
  };
}

// --- Tool-call execution ---
async function runTool(
  call: ToolCall,
  ctx: { navigate: (p: any, params?: Record<string, string>) => void },
): Promise<string> {
  const s = dbState();
  switch (call.name) {
    case 'add_task': {
      const a = call.args;
      const project = a.project_hint
        ? s.projects.find((p) => p.name.toLowerCase().includes(String(a.project_hint).toLowerCase()))?.id ?? null
        : null;
      const task = await createTask({
        title: a.title,
        due_date: a.due_date ?? todayStr(),
        due_time: a.due_time ?? null,
        priority: (a.priority ?? 'medium') as any,
        reminder_minutes: a.remind_me === false ? null : (a.reminder_minutes ?? 0),
        remind_me: a.remind_me !== false,
        project_id: project,
      } as any);
      // Alarm pipeline refreshes within a minute; nudge it now.
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      const when = a.due_date ? ` for ${a.due_time ? a.due_time + ' on ' : ''}${a.due_date}` : '';
      const ring = a.remind_me === false ? '' : ' Alarm on.';
      return `Added task ${a.title}${when}.${ring}`;
    }
    case 'add_note': {
      await createNote({ title: String(call.args.title).slice(0, 80), content: call.args.content ?? '' });
      return `Note added: ${call.args.title}`;
    }
    case 'add_reminder': {
      await createReminder({
        title: call.args.title,
        due_at: call.args.due_at ?? new Date(Date.now() + 3600_000).toISOString(),
        priority: 'medium',
      });
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return `Reminder set: ${call.args.title}`;
    }
    case 'complete_task':
    case 'delete_task':
    case 'set_reminder': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const t = s.tasks.find((x) => !x.deleted && !x.archived && x.title.toLowerCase().includes(q))
        ?? s.tasks.find((x) => !x.deleted && !x.archived && q.includes(x.title.toLowerCase()));
      if (!t) return `I couldn't find a task matching "${call.args.title_match}"`;
      if (call.name === 'complete_task') {
        await updateTask(t.id, { status: 'completed', completed_at: new Date().toISOString(), completed_at_date: todayStr() } as any);
        return `Completed: ${t.title}`;
      }
      if (call.name === 'delete_task') {
        await deleteTask(t.id);
        return `Deleted: ${t.title}`;
      }
      const on = !!call.args.remind_me;
      await updateTask(t.id, { remind_me: on, reminder_minutes: on ? (t.reminder_minutes ?? 0) : t.reminder_minutes } as any);
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return on ? `Reminders on for ${t.title}` : `Reminders off for ${t.title}`;
    }
    case 'navigate': {
      ctx.navigate(call.args.page);
      return `Opened ${call.args.page}`;
    }
    case 'open_app': {
      const n = nativeSpeech();
      // Android: the background service opens the app itself; from inside the
      // app this is already the foreground. Desktop: focus the window.
      try { (window as any).LifeOSNative?.openApp?.(); } catch { /* no-op */ }
      return 'Opening LifeOS';
    }
    case 'summarize_day': {
      const today = todayStr();
      const tasks = s.tasks.filter((t) => !t.deleted && !t.archived && t.due_date === today && t.status !== 'completed');
      const rems = s.reminders.filter((r) => (r.due_at ?? '').slice(0, 10) === today);
      const names = tasks.slice(0, 5).map((t) => t.title + (t.due_time ? ` at ${t.due_time.slice(0, 5)}` : ''));
      return `Today: ${tasks.length} task${tasks.length === 1 ? '' : 's'} and ${rems.length} reminder${rems.length === 1 ? '' : 's'}` + (names.length ? `. ${names.join(', ')}` : '');
    }
    default:
      return `I don't know how to ${call.name}`;
  }
}

// --- Main entry: spoken text → actions → spoken reply ---
export interface CommandResult { ok: boolean; message: string; }

export async function executeCommand(
  spoken: string,
  ctx: { page: string; pageParams: Record<string, string>; navigate: (p: any, params?: Record<string, string>) => void },
): Promise<CommandResult> {
  const settings = getAssistantSettings();

  // 1) AI brain (when enabled): free-form understanding with app context.
  if (settings.useAI) {
    try {
      const { reply, calls } = await askBrain(spoken, buildAppContext(ctx.page, ctx.pageParams));
      const parts: string[] = [];
      for (const c of calls) {
        try { parts.push(await runTool(c, ctx)); } catch (e: any) { parts.push(e?.message ?? 'action failed'); }
      }
      const message = parts.length ? parts.join(' ') : (reply || "I couldn't map that to an action");
      return { ok: parts.length > 0, message };
    } catch {
      // fall through to offline parser
    }
  }

  // 2) Offline fallback parser (also the path when useAI is off).
  const intent: AssistantIntent = parseCommand(spoken);
  switch (intent.kind) {
    case 'add_task': {
      const p = parseQuickAdd(intent.text);
      await createTask({
        title: p.title,
        due_date: intent.presetDate ?? p.due_date ?? todayStr(),
        due_time: intent.presetTime ?? p.due_time,
        priority: (intent.priority ?? p.priority ?? 'medium') as any,
        reminder_minutes: 0,
        remind_me: true,
      } as any);
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return { ok: true, message: `Task added: ${p.title}` };
    }
    case 'add_reminder': {
      const p = parseQuickAdd(intent.text);
      await createReminder({ title: intent.text || p.title, due_at: intent.due_at ?? new Date(Date.now() + 3600_000).toISOString(), priority: 'medium' });
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return { ok: true, message: `Reminder set: ${intent.text}` };
    }
    case 'add_note': {
      await createNote({ title: intent.title.slice(0, 80) || 'Voice note', content: intent.content });
      return { ok: true, message: `Note added: ${intent.title}` };
    }
    case 'navigate': {
      ctx.navigate(intent.page);
      return { ok: true, message: `Opened ${intent.page}` };
    }
    case 'summarize_day': {
      const s = dbState();
      const today = todayStr();
      const tasks = s.tasks.filter((t) => !t.deleted && !t.archived && t.due_date === today && t.status !== 'completed');
      const rems = s.reminders.filter((r) => (r.due_at ?? '').slice(0, 10) === today);
      const msg = `Today you have ${tasks.length} task${tasks.length === 1 ? '' : 's'} and ${rems.length} reminder${rems.length === 1 ? '' : 's'}`;
      return { ok: true, message: msg };
    }
    default:
      return { ok: false, message: "I didn't catch a command. Try \"add task…\", \"remind me to…\", \"open calendar\" or \"what's on my day\"." };
  }
}

// --- Wake-word helpers (kept from previous version) ---
export function extractWakeCommand(text: string, settings: AssistantSettings): string | null {
  const t = text.trim();
  if (!t) return null;
  const w = settings.wakeWord.toLowerCase();
  const i = t.toLowerCase().indexOf(w);
  if (i === -1) return null;
  return t.slice(i + w.length).replace(/^[\s,.]+/, '');
}
