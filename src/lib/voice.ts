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
import {
  createTask, createNote, deleteNote, createReminder, deleteReminder, updateTask, deleteTask,
  createIdea, deleteIdea, convertIdeaToProject, createRememberItem, deleteRememberItem,
  createProject, deleteProject, createGoal, deleteGoal, dbState, getSettings,
  createRoutineTask, deleteRoutineTask,
  createProjectMilestone, updateProjectMilestone, deleteProjectMilestone,
  createGoalMilestone, updateGoalMilestone, deleteGoalMilestone,
} from './db';
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
  // Voice assistant is ON by default: first-time users should get the
  // full experience without digging through settings. Users who explicitly
  // turned it off keep their choice (their saved 'enabled: false' wins).
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { enabled: true, wakeWord: 'hey lifeos', listenContinuously: true, useAI: true, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { enabled: true, wakeWord: 'hey lifeos', listenContinuously: true, useAI: true };
}
export function saveAssistantSettings(s: AssistantSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// --- Recognizer plumbing (web + native) ---
let recog: SR | null = null;
let wantListening = false;
let onHeard: ((text: string, isFinal: boolean) => void) | null = null;
let onError: ((err: string) => void) | null = null;

// --- Mic muting during speech (anti-feedback) ---
// While the assistant talks, the mic hears the TTS through the speaker and
// transcribes its own voice — that is the "tweaking" noise AND the reason
// commands get eaten (garbage finals flood the pipeline). We hard-mute the
// recognizer (and the native bridge) whenever speech synthesis is active,
// plus a tail window after it ends (audio buffers + speaker latency).
let muted = false;
let unmuteTimer: ReturnType<typeof setTimeout> | null = null;

function setMuted(m: boolean) {
  if (muted === m) return;
  muted = m;
  try { (window as any).__lifeosMicMuted = m; } catch { /* ignore */ }
  const n = nativeSpeech();
  try { n?.setMuted?.(m); } catch { /* older bridges have no mute; we drop results instead */ }
}

export function duckMicForSpeech(): void {
  setMuted(true);
  if (unmuteTimer) clearTimeout(unmuteTimer);
}

export function unduckMicAfterSpeech(): void {
  // 350ms tail: recognizers buffer audio; cutting exactly at speech end can
  // still transcribe the last syllable echoed from the speaker.
  if (unmuteTimer) clearTimeout(unmuteTimer);
  unmuteTimer = setTimeout(() => setMuted(false), 350);
}

// --- Barge-in (interrupt the assistant mid-sentence) ---
// While the assistant speaks, the mic is muted so it never transcribes its
// own voice. But hard-dropping EVERYTHING also killed the user's ability to
// interrupt. So while muted, transcripts are dropped UNLESS they look like a
// deliberate interrupt ("stop", "wait", "cancel", "hey lifeos"...), and ONLY
// if the transcript isn't just an echo of the sentence we're speaking.
const BARGE_IN_RE = /\b(stop|stop it|wait|wait wait|cancel|never ?mind|hey lifeos|hello lifeos|hold on)\b/i;

function isBargeIn(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  // Ignore echoes of what the assistant itself is saying: if the transcript
  // is a substring of the currently-spoken message (or vice versa) it's the
  // recognizer picking up TTS, not the user.
  const speaking = (typeof window !== 'undefined' ? (window as any).__lifeosSpeaking : '') || '';
  if (speaking) {
    const a = t.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const b = speaking.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (a && b && (b.includes(a) || a.startsWith(b.slice(0, Math.min(24, b.length))))) return false;
  }
  return BARGE_IN_RE.test(t);
}

function nativeResult(text: string) { if (muted && !isBargeIn(text)) return; onHeard?.(text, true); }
function nativePartial(text: string) { if (muted && !isBargeIn(text)) return; onHeard?.(text, false); }

// --- Latency instrumentation (privacy-safe) ---
// Stage names and milliseconds only — never transcripts or task content.
// Surfaced in Settings → Voice Assistant so device-side stalls are visible.
export type VoiceStage =
  | 'listen_start'        // mic tapped / auto-start fired
  | 'recognizer_ready'    // first onSpeechReady / web recognizer start accepted
  | 'final_transcript'    // final transcript arrived
  | 'reply_ready';        // command executed, reply text ready
const MAX_PERF_ENTRIES = 12;
let perf: { t: number; stage: VoiceStage; ms: number | null }[] = [];
let stageStart: Partial<Record<VoiceStage, number>> = {};

export function voicePerfMark(stage: VoiceStage): void {
  const now = Date.now();
  const anchor: VoiceStage =
    stage === 'recognizer_ready' || stage === 'final_transcript' ? 'listen_start'
    : stage === 'reply_ready' ? 'final_transcript'
    : stage;
  const ms = anchor !== stage && stageStart[anchor] != null ? now - stageStart[anchor]! : null;
  stageStart[stage] = now;
  perf.push({ t: now, stage, ms });
  if (perf.length > MAX_PERF_ENTRIES) perf = perf.slice(-MAX_PERF_ENTRIES);
  try { console.info(`[voice-perf] ${stage}${ms != null ? ` +${ms}ms` : ''}`); } catch { /* ignore */ }
}

/** Recent stage timings (newest last) — for the Settings diagnostics row. */
export function getVoicePerf(): { stage: VoiceStage; ms: number | null; ago: number }[] {
  const now = Date.now();
  return perf.map((p) => ({ stage: p.stage, ms: p.ms, ago: now - p.t }));
}

// --- Native TTS (Android shell) ---
// The Android WebView exposes window.speechSynthesis but it SILENTLY DOES
// NOTHING there — spoken replies must go through the LifeOSSpeech bridge
// (SpeechBridge.speak). We expose the same duck/unduck contract so the
// anti-feedback mute still applies.
export function nativeTtsSpeak(text: string, onEnd?: () => void): boolean {
  installNativeSpeech();          // ensure callbacks exist before the engine calls back
  const n = nativeSpeech();
  if (!n || typeof n.speak !== 'function') return false;
  let ended = false;
  const finish = () => { if (ended) return; ended = true; try { delete (window as any).__lifeosSpeaking; } catch { /* ignore */ } onEnd?.(); };
  try { (window as any).__lifeosSpeaking = text; } catch { /* ignore */ } // barge-in echo check reads this
  // Watchdog: if the native engine never reports an end (missing TTS engine,
  // stalled init, swallowed callback), unduck anyway so the mic is never
  // stuck muted — a stuck mute made the assistant permanently deaf.
  const watchdog = setTimeout(finish, 12_000);
  try {
    (window as any).__lifeosSpeech.onSpeakEnd = (status: string) => {
      clearTimeout(watchdog);
      finish();
      if (status === 'unavailable') unavailableHandler?.();
    };
    n.speak(text);
    return true;
  } catch {
    clearTimeout(watchdog);
    finish();
    return false;
  }
}

export function nativeTtsStop(): void {
  try { delete (window as any).__lifeosSpeaking; } catch { /* ignore */ }
  const n = nativeSpeech();
  try { n?.stopSpeak?.(); } catch { /* ignore */ }
}

export function nativeTtsSupported(): boolean {
  const n = nativeSpeech();
  return !!(n && typeof n.speak === 'function');
}
function nativeError(code: string) {
  if (code === '6' || code === '7' || code === 'no_match' || code === '8' || code === 'busy') return;
  // ERROR_CLIENT (5) is transient on many devices — the Android side now
  // recreates the recognizer; here just surface a gentle note, not an error.
  if (code === '5') return;
  if (code === 'not_available' || code === 'exception') onError?.('Speech recognition not available on this device');
  else if (code === '9' || code === '10') onError?.('Microphone permission denied');
  else onError?.('Speech error ' + code);
}

/** Called when the device reports it has no working TTS engine. */
let unavailableHandler: (() => void) | null = null;
export function setTtsUnavailableHandler(fn: (() => void) | null): void { unavailableHandler = fn; }

export function installNativeSpeech(): void {
  const n = nativeSpeech();
  if (!n || typeof window === 'undefined') return;
  // Preserve a pending onSpeakEnd: startListening() re-installs this object
  // right after speak() armed it, and clobbering it used to leave the mic
  // ducked forever (assistant went silent after the first reply).
  const prev = (window as any).__lifeosSpeech;
  (window as any).__lifeosSpeech = {
    onSpeechResult: nativeResult,
    onSpeechPartial: nativePartial,
    onSpeechError: nativeError,
    onSpeechReady: () => { voicePerfMark('recognizer_ready'); },
    ...(prev?.onSpeakEnd ? { onSpeakEnd: prev.onSpeakEnd } : {}),
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
    // Same mute contract as the native bridge: drop echo while ducked, but
    // always let a deliberate barge-in phrase through.
    if (final) {
      if (muted && !isBargeIn(final)) return;
      onHeard?.(final.trim(), true);
    }
    else if (interim) {
      if (muted && !isBargeIn(interim)) return;
      onHeard?.(interim.trim(), false);
    }
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
    // Continuous mode: restart unless the user asked to stop. If the mic is
    // ducked (assistant speaking), wait for the unmute tail first — starting
    // mid-speech just transcribes our own voice.
    if (wantListening) {
      const retry = () => { if (wantListening) { try { r.start(); } catch { /* already started */ } } };
      if (muted) { const t = setInterval(() => { if (!muted) { clearInterval(t); retry(); } }, 120); }
      else retry();
    }
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
  voicePerfMark('listen_start');
  const n = nativeSpeech();
  if (n && typeof n.startContinuous === 'function') {
    installNativeSpeech();
    try { n.startContinuous(); return true; } catch { /* fall through */ }
  }
  if (!recog) recog = buildRecognizer();
  if (!recog) return false;
  try { recog.start(); voicePerfMark('recognizer_ready'); } catch { /* already running */ }
  return true;
}

export function stopListening(): void {
  wantListening = false;
  const n = nativeSpeech();
  if (n && typeof n.stopContinuous === 'function') { try { n.stopContinuous(); } catch { /* ignore */ } }
  try { recog?.stop(); } catch { /* ignore */ }
}

// --- Mic hand-off (idea voice notes etc.) ---
// Android allows ONE mic client at a time: while the assistant's continuous
// recognizer runs, MediaRecorder's getUserMedia fails with "LifeOS is
// recording". These helpers release the recognizer for the duration of an
// explicit recording and resume it afterwards.
export function pauseMicForRecording(): void {
  const n = nativeSpeech();
  if (n && typeof n.stopContinuous === 'function') { try { n.stopContinuous(); } catch { /* ignore */ } }
  try { recog?.stop(); } catch { /* ignore */ }
}

export function resumeMicAfterRecording(): void {
  if (!wantListening) return; // assistant wasn't listening — nothing to restore
  const n = nativeSpeech();
  if (n && typeof n.startContinuous === 'function') {
    try { n.startContinuous(); } catch { /* retry loop will recover */ }
    return;
  }
  if (recog) { try { recog.start(); } catch { /* onend retry loop recovers */ } }
}

export function isListening(): boolean { return wantListening; }

// --- Context for the brain ---
// Privacy: only the minimum fields the model needs to resolve a command.
// Names only — no ids beyond project names, no notes content, no descriptions,
// no email. recentTaskTitles is capped at 10 so open-ended browsing history
// is never shipped to the AI provider.
export function buildAppContext(page: string, pageParams: Record<string, string>): AppContext {
  const s = dbState();
  const now = new Date();
  return {
    page,
    pageParams: {}, // page params can embed task ids — not needed by the model
    today: todayStr(),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    projects: s.projects.filter((p) => !p.archived).slice(0, 20).map((p) => ({ id: p.name, name: p.name })),
    categories: s.categories.slice(0, 20).map((c) => ({ id: c.name, name: c.name })),
    recentTaskTitles: s.tasks.filter((t) => !t.deleted && !t.archived).slice(-10).map((t) => t.title),
    todayTaskCount: s.tasks.filter((t) => !t.deleted && t.due_date === todayStr() && t.status !== 'completed').length,
    routines: (s.routine_tasks ?? []).filter((r) => !r.archived).slice(0, 15).map((r) =>
      r.title + (Array.isArray(r.days) && r.days.length ? ` (${r.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')})` : '')
    ),
  };
}

// --- Tool-call execution ---
function taskDaysOf(x: any): number[] {
  if (Array.isArray(x.days) && x.days.length) return x.days.map(Number);
  return x.weekday != null ? [Number(x.weekday)] : [];
}

function fmtTask(t: any): string {
  const when = t.due_date
    ? ` on ${t.due_date.slice(5)}` + (t.due_time ? ` at ${t.due_time.slice(0, 5)}` : '')
    : '';
  return `${t.title}${when}${t.status === 'completed' ? ' (done)' : ''}`;
}

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
        recurrence: (call.args.recurrence ?? null) as any,
      });
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return `Reminder set: ${call.args.title}`;
    }
    case 'delete_reminder': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const r = s.reminders.find((x) => !x.deleted && x.title.toLowerCase().includes(q))
        ?? s.reminders.find((x) => !x.deleted && q.includes(x.title.toLowerCase()));
      if (!r) return `I couldn't find a reminder matching "${call.args.title_match}"`;
      await deleteReminder(r.id);
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return `Deleted reminder: ${r.title}`;
    }
    case 'delete_note': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const n = s.notes.find((x) => !x.deleted && x.title.toLowerCase().includes(q))
        ?? s.notes.find((x) => !x.deleted && q.includes(x.title.toLowerCase()));
      if (!n) return `I couldn't find a note matching "${call.args.title_match}"`;
      await deleteNote(n.id);
      return `Deleted note: ${n.title}`;
    }
    case 'add_idea': {
      await createIdea({
        title: String(call.args.title ?? '').slice(0, 80) || 'Voice idea',
        description: call.args.description ?? null,
      });
      return `Idea saved: ${call.args.title}`;
    }
    case 'delete_idea': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const i = s.ideas.find((x) => !x.deleted && x.title.toLowerCase().includes(q))
        ?? s.ideas.find((x) => !x.deleted && q.includes(x.title.toLowerCase()));
      if (!i) return `I couldn't find an idea matching "${call.args.title_match}"`;
      await deleteIdea(i.id);
      return `Deleted idea: ${i.title}`;
    }
    case 'idea_to_project': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const i = s.ideas.find((x) => !x.deleted && x.title.toLowerCase().includes(q))
        ?? s.ideas.find((x) => !x.deleted && q.includes(x.title.toLowerCase()));
      if (!i) return `I couldn't find an idea matching "${call.args.title_match}"`;
      const p = await convertIdeaToProject(i.id);
      return p ? `Turned "${i.title}" into the project "${p.name}".` : `Could not convert ${i.title}.`;
    }
    case 'open_capture': {
      // The UI listens for this event (VoiceAssistant dispatches it) and
      // opens the idea-capture modal — camera or text, the user's choice.
      window.dispatchEvent(new CustomEvent('lifeos-open-capture'));
      return 'Opening idea capture — take a photo or type it.';
    }
    case 'add_remember': {
      await createRememberItem({ title: String(call.args.title ?? '').slice(0, 80), content: call.args.content ?? '' });
      return `Remember item saved: ${call.args.title}`;
    }
    case 'delete_remember': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const it = s.remember_items.find((x) => !x.deleted && x.title.toLowerCase().includes(q))
        ?? s.remember_items.find((x) => !x.deleted && q.includes(x.title.toLowerCase()));
      if (!it) return `I couldn't find that in Remember.`;
      await deleteRememberItem(it.id);
      return `Deleted remember item: ${it.title}`;
    }
    case 'add_routine': {
      const a = call.args;
      const days: number[] | null = Array.isArray(a.days) && a.days.length ? a.days.map(Number) : null;
      const rt = await createRoutineTask({
        title: String(a.title ?? ''),
        days,
        extra_date: !days ? (a.extra_date ?? null) : null,
        time_of_day: a.time_of_day ?? null,
      });
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      const sched = days?.length
        ? ` on ${days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`
        : rt.extra_date ? ` on ${rt.extra_date}` : '';
      return `Routine added: ${rt.title}${sched}${a.time_of_day ? ` at ${a.time_of_day}` : ''}`;
    }
    case 'delete_routine': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const rt = s.routine_tasks.find((x) => !x.archived && x.title.toLowerCase().includes(q))
        ?? s.routine_tasks.find((x) => !x.archived && q.includes(x.title.toLowerCase()));
      if (!rt) return `I couldn't find a routine matching "${call.args.title_match}"`;
      await deleteRoutineTask(rt.id);
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      return `Deleted routine: ${rt.title}`;
    }
    case 'query_routines': {
      const list = s.routine_tasks.filter((x) => !x.archived);
      if (!list.length) return 'You have no routines set up.';
      const shown = list.slice(0, 8).map((x) => {
        const days = taskDaysOf(x);
        const sched = days.length ? days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : (x.extra_date ?? 'one-off');
        return `${x.title} (${sched}${x.time_of_day ? ` at ${x.time_of_day.slice(0, 5)}` : ''})`;
      });
      return `${list.length} routine${list.length === 1 ? '' : 's'}: ${shown.join('; ')}`;
    }
    // ---------- Milestones (projects & goals) ----------
    case 'add_milestone': {
      const a = call.args;
      const scope = a.scope === 'goal' ? 'goal' : 'project';
      const q = String(a.name_match ?? '').toLowerCase();
      if (scope === 'project') {
        const p = s.projects.find((x) => !x.archived && x.name.toLowerCase().includes(q))
          ?? s.projects.find((x) => !x.archived && q.includes(x.name.toLowerCase()));
        if (!p) return `I couldn't find a project matching "${a.name_match}"`;
        const m = await createProjectMilestone(p.id, String(a.title ?? ''), a.due_date ?? null);
        return `Milestone added to ${p.name}: ${m.title}`;
      }
      const g = s.goals.find((x) => x.status === 'active' && x.title.toLowerCase().includes(q))
        ?? s.goals.find((x) => x.status === 'active' && q.includes(x.title.toLowerCase()));
      if (!g) return `I couldn't find a goal matching "${a.name_match}"`;
      const gm = await createGoalMilestone(g.id, String(a.title ?? ''));
      return `Milestone added to ${g.title}: ${gm.title}`;
    }
    case 'complete_milestone':
    case 'delete_milestone': {
      const a = call.args;
      const scope = a.scope === 'goal' ? 'goal' : 'project';
      const q = String(a.name_match ?? '').toLowerCase();
      const mq = String(a.title_match ?? '').toLowerCase();
      if (scope === 'project') {
        const p = s.projects.find((x) => !x.archived && x.name.toLowerCase().includes(q));
        if (!p) return `I couldn't find a project matching "${a.name_match}"`;
        const ms = s.project_milestones.filter((m) => m.project_id === p.id);
        const m = ms.find((x) => x.title.toLowerCase().includes(mq)) ?? ms.find((x) => mq.includes(x.title.toLowerCase()));
        if (!m) return `I couldn't find a milestone matching "${a.title_match}" in ${p.name}`;
        if (call.name === 'complete_milestone') {
          await updateProjectMilestone(m.id, { done: true } as any);
          return `Milestone done: ${m.title}`;
        }
        await deleteProjectMilestone(m.id);
        return `Deleted milestone: ${m.title}`;
      }
      const g = s.goals.find((x) => x.title.toLowerCase().includes(q));
      if (!g) return `I couldn't find a goal matching "${a.name_match}"`;
      const ms = s.goal_milestones.filter((m) => m.goal_id === g.id);
      const m = ms.find((x) => x.title.toLowerCase().includes(mq)) ?? ms.find((x) => mq.includes(x.title.toLowerCase()));
      if (!m) return `I couldn't find a milestone matching "${a.title_match}" in ${g.title}`;
      if (call.name === 'complete_milestone') {
        await updateGoalMilestone(m.id, { done: true } as any);
        return `Milestone done: ${m.title}`;
      }
      await deleteGoalMilestone(m.id);
      return `Deleted milestone: ${m.title}`;
    }
    // ---------- Recurrence on tasks ----------
    case 'set_recurrence': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const t = s.tasks.find((x) => !x.deleted && !x.archived && x.title.toLowerCase().includes(q))
        ?? s.tasks.find((x) => !x.deleted && !x.archived && q.includes(x.title.toLowerCase()));
      if (!t) return `I couldn't find a task matching "${call.args.title_match}"`;
      const rule = String(call.args.rule ?? 'weekly');
      const days: number[] | null = Array.isArray(call.args.days) && call.args.days.length ? call.args.days.map(Number) : null;
      // Task model supports daily/weekly/monthly/yearly via recurrence +
      // weekday list; 'weekdays' maps to the Mon-Fri day list.
      const mapped = rule === 'weekdays' ? 'weekly' : rule;
      const patch: Record<string, unknown> = { recurrence: mapped as any };
      if (mapped === 'weekly') {
        patch.recurrence_days = days ?? [t.due_date ? new Date(t.due_date + 'T00:00:00').getDay() : new Date().getDay()];
        patch.recurrence_monthday = null;
      } else if (mapped === 'monthly') {
        patch.recurrence_days = null;
        patch.recurrence_monthday = t.due_date ? new Date(t.due_date + 'T00:00:00').getDate() : null;
      } else {
        patch.recurrence_days = null;
        patch.recurrence_monthday = null;
      }
      if (!t.recurrence_anchor && t.due_date) patch.recurrence_anchor = t.due_date;
      await updateTask(t.id, patch as any);
      return `Repeating ${rule}: ${t.title}`;
    }
    case 'remove_recurrence': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const t = s.tasks.find((x) => !x.deleted && !x.archived && x.title.toLowerCase().includes(q))
        ?? s.tasks.find((x) => !x.deleted && !x.archived && q.includes(x.title.toLowerCase()));
      if (!t) return `I couldn't find a task matching "${call.args.title_match}"`;
      await updateTask(t.id, { recurrence: null, recurrence_days: null, recurrence_monthday: null } as any);
      return `${t.title} no longer repeats`;
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
    case 'query_tasks': {
      const a = call.args ?? {};
      const today = todayStr();
      let list = s.tasks.filter((t) => !t.deleted && !t.archived);
      if (a.title_contains) {
        const q = String(a.title_contains).toLowerCase();
        list = list.filter((t) => t.title.toLowerCase().includes(q));
      }
      if (a.date) {
        list = list.filter((t) => t.due_date === a.date);
      } else {
        const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
        const weekEnd = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);
        switch (a.date_range) {
          case 'today': list = list.filter((t) => t.due_date === today); break;
          case 'tomorrow': list = list.filter((t) => t.due_date === tomorrow); break;
          case 'this_week': list = list.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekEnd); break;
          case 'overdue': list = list.filter((t) => t.due_date && t.due_date < today && t.status !== 'completed'); break;
          default: break; // 'all' or unspecified — leave unfiltered
        }
      }
      list.sort((x, y) => (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999') || (x.due_time ?? '').localeCompare(y.due_time ?? ''));
      const shown = list.slice(0, 8).map(fmtTask);
      return list.length
        ? `${list.length} task${list.length === 1 ? '' : 's'}: ${shown.join('; ')}`
        : 'No tasks found for that.';
    }
    case 'update_task': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const t = s.tasks.find((x) => !x.deleted && !x.archived && x.title.toLowerCase().includes(q))
        ?? s.tasks.find((x) => !x.deleted && !x.archived && q.includes(x.title.toLowerCase()));
      if (!t) return `I couldn't find a task matching "${call.args.title_match}"`;
      const patch: Record<string, unknown> = {};
      if (call.args.due_date) patch.due_date = call.args.due_date;
      if (call.args.due_time) { patch.due_time = call.args.due_time; patch.remind_me = t.remind_me ?? true; }
      if (call.args.priority) patch.priority = call.args.priority;
      if (call.args.new_title) patch.title = call.args.new_title;
      if (!Object.keys(patch).length) return 'Nothing to change.';
      await updateTask(t.id, patch as any);
      import('./nativeAlarms').then((m) => m.syncNativeAlarms());
      const changes = [
        call.args.due_date ? `date ${call.args.due_date}` : null,
        call.args.due_time ? `time ${call.args.due_time}` : null,
        call.args.priority ? `priority ${call.args.priority}` : null,
        call.args.new_title ? `renamed to ${call.args.new_title}` : null,
      ].filter(Boolean).join(', ');
      return `Updated ${t.title}: ${changes}`;
    }
    case 'create_project': {
      const name = String(call.args.name ?? '').slice(0, 60);
      if (!name) return 'I need a name for the project.';
      await createProject({ name } as any);
      return `Project created: ${name}`;
    }
    case 'delete_project': {
      const q = String(call.args.name_match ?? '').toLowerCase();
      const p = s.projects.find((x) => !x.archived && x.name.toLowerCase().includes(q));
      if (!p) return `I couldn't find a project matching "${call.args.name_match}"`;
      await deleteProject(p.id);
      return `Deleted project ${p.name}. Its tasks are kept but unlinked.`;
    }
    case 'create_goal': {
      const title = String(call.args.title ?? '').slice(0, 80);
      if (!title) return 'What is the goal?';
      await createGoal({ title } as any);
      return `Goal set: ${title}`;
    }
    case 'delete_goal': {
      const q = String(call.args.title_match ?? '').toLowerCase();
      const g = s.goals.find((x) => x.title.toLowerCase().includes(q));
      if (!g) return `I couldn't find a goal matching "${call.args.title_match}"`;
      await deleteGoal(g.id);
      return `Deleted goal: ${g.title}`;
    }
    case 'navigate': {
      const page = String(call.args.page ?? 'home');
      const tab = call.args.tab ? String(call.args.tab) : undefined;
      // Library sections: 'notes' | 'ideas' | 'remember' all live inside the
      // Library page as subtabs.
      if (page === 'library' && tab) {
        (window as any).__lifeosLibraryTab = tab;
        window.dispatchEvent(new CustomEvent('lifeos-library-tab', { detail: tab }));
        ctx.navigate('library');
      } else {
        // Direct legacy keys route to Library with the right tab preselected.
        if (page === 'notes' || page === 'ideas' || page === 'remember') {
          (window as any).__lifeosLibraryTab = page;
          window.dispatchEvent(new CustomEvent('lifeos-library-tab', { detail: page }));
          ctx.navigate('library');
        } else {
          ctx.navigate(page as any);
        }
      }
      return `Opened ${tab ?? page}`;
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
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<CommandResult> {
  const settings = getAssistantSettings();

  // 1) AI brain (when enabled): free-form understanding with app context.
  if (settings.useAI) {
    try {
      const { reply, calls } = await askBrain(spoken, buildAppContext(ctx.page, ctx.pageParams), history);
      const parts: string[] = [];
      for (const c of calls) {
        try { parts.push(await runTool(c, ctx)); } catch (e: any) { parts.push(e?.message ?? 'action failed'); }
      }
      // The model's own reply IS the conversation — tool results only fill in
      // when the model stayed silent (e.g. pure action with no content).
      const message = reply || (parts.length ? parts.join(' ') : "I couldn't map that to an action");
      return { ok: parts.length > 0 || !!reply, message };
    } catch {
      // fall through to offline parser
    }
  }

  // 2) Offline fallback parser (also the path when useAI is off).
  const intent: AssistantIntent = parseCommand(spoken);
  switch (intent.kind) {
    case 'delete_task': {
      const q = intent.title_match.toLowerCase();
      const t = dbState().tasks.find((x) => !x.deleted && !x.archived && x.title.toLowerCase().includes(q));
      if (!t) return { ok: false, message: `I couldn't find a task matching "${intent.title_match}"` };
      await deleteTask(t.id);
      return { ok: true, message: `Deleted: ${t.title}` };
    }
    case 'delete_reminder': {
      const q = intent.title_match.toLowerCase();
      const r = dbState().reminders.find((x) => !x.deleted && x.title.toLowerCase().includes(q));
      if (!r) return { ok: false, message: `I couldn't find a reminder matching "${intent.title_match}"` };
      await deleteReminder(r.id);
      return { ok: true, message: `Deleted reminder: ${r.title}` };
    }
    case 'delete_note': {
      const q = intent.title_match.toLowerCase();
      const n = dbState().notes.find((x) => !x.deleted && x.title.toLowerCase().includes(q));
      if (!n) return { ok: false, message: `I couldn't find a note matching "${intent.title_match}"` };
      await deleteNote(n.id);
      return { ok: true, message: `Deleted note: ${n.title}` };
    }
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

// --- Wake-word helpers ---
// 'hello' is accepted as an alias of the configured wake word so natural
// phrases like "hello" or "hello lifeos" both open a conversation session.
export function extractWakeCommand(text: string, settings: AssistantSettings): string | null {
  const t = text.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const w = settings.wakeWord.toLowerCase().trim();
  const candidates = [w, ...(w && w !== 'hello' ? ['hello'] : [])].filter(Boolean)
    // longest first so "hey lifeos" wins over "hello" inside it
    .sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i === -1) continue;
    // Match must start at a word boundary so "hello" inside another word doesn't fire.
    const before = i === 0 ? ' ' : lower[i - 1];
    if (before !== ' ') continue;
    return t.slice(i + c.length).replace(/^[\s,.]+/, '');
  }
  return null;
}
