// Voice runtime: explicit activation, bounded private context and cancellable plans.
import { parseCommand } from './assistant';
import { askBrain, type AppContext, type ToolCall } from './brain';
import { dbState } from './db';
import { todayStr } from './dates';
import { parseQuickAdd } from './quickadd';
import { executePlan, stopIntent, type PlanResult } from './assistantSafety';
import { runAssistantTool } from './assistantTools';
import { AssistantError, assistantError, type AssistantErrorCode } from './assistantError';
export { stopIntent } from './assistantSafety';

export function nativeSpeech(): any | null { return typeof window !== 'undefined' ? (window as any).LifeOSSpeech ?? null : null; }
export function speechSupported(): boolean { return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || nativeSpeech()); }
export interface AssistantSettings { enabled: boolean; wakeWord: string; listenContinuously: boolean; useAI: boolean; wakeConsent?: boolean }
const KEY = 'lifeos.assistant';
export function getAssistantSettings(): AssistantSettings {
  const defaults = { enabled: true, wakeWord: 'hey lifeos', listenContinuously: false, useAI: true, wakeConsent: false };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { enabled: s.enabled !== false, wakeWord: typeof s.wakeWord === 'string' && s.wakeWord.trim() ? s.wakeWord.trim().slice(0,60) : defaults.wakeWord, useAI: s.useAI !== false, listenContinuously: s.wakeConsent === true && s.listenContinuously === true, wakeConsent: s.wakeConsent === true };
  } catch { return defaults; }
}
export function saveAssistantSettings(s: AssistantSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lifeos-assistant-settings'));
}

let recog: any = null;
let wantListening = false;
let recording = false;
let ready = false;
let loading = false;
export type VoiceListenState = 'starting' | 'loading' | 'listening' | 'stopped';
export const VOICE_MODEL_LOAD_TIMEOUT_MS = 90_000;
let onHeard: ((text: string, final: boolean) => void) | null = null;
let onError: ((error: string) => void) | null = null;
let onState: ((state: VoiceListenState) => void) | null = null;
let onBeginning: (() => void) | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
let muted = false;
let unmuteTimer: ReturnType<typeof setTimeout> | null = null;
let ttsFinish: (() => void) | null = null;
let unavailableHandler: (() => void) | null = null;

function setMuted(value: boolean) {
  muted = value;
  if (typeof window !== 'undefined') (window as any).__lifeosMicMuted = value;
  // Modern native bridge retains an interruption recognizer while ducked.
  try { nativeSpeech()?.setMuted?.(value); } catch { /* older bridge */ }
}
export function duckMicForSpeech(): void { if (unmuteTimer) clearTimeout(unmuteTimer); setMuted(true); }
export function unduckMicAfterSpeech(): void { if (unmuteTimer) clearTimeout(unmuteTimer); unmuteTimer = setTimeout(() => setMuted(false), 350); }
export function releaseSpeechMute(): void { if (unmuteTimer) clearTimeout(unmuteTimer); setMuted(false); }
function speakingText(): string { return typeof window === 'undefined' ? '' : (window as any).__lifeosSpeaking ?? ''; }
function isBargeIn(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const speaking = speakingText().toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (t && speaking && speaking.includes(t)) return false;
  return !!stopIntent(text) || /^(?:please\s+)?(?:stop|wait|cancel|hold on|never ?mind|hey lifeos|hello lifeos)\b/i.test(text.trim());
}
function deliver(text: string, final: boolean) {
  if (!wantListening || recording || typeof text !== 'string' || !text.trim()) return;
  if (muted && !isBargeIn(text)) return;
  onHeard?.(text.trim(), final);
}
function recognizerReady() {
  if (!wantListening || recording) return;
  ready = true; loading = false;
  if (readyTimer) clearTimeout(readyTimer);
  voicePerfMark('recognizer_ready');
  onState?.('listening');
}
function recognizerBeginning() {
  if (wantListening && !recording && ready) onBeginning?.();
}
function waitForReady(modelLoading: boolean) {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    if (!ready && wantListening) fail(modelLoading
      ? 'The offline speech model did not finish loading. Tap the mic to try again.'
      : 'The microphone did not become ready. Check permission and tap again.');
  }, modelLoading ? VOICE_MODEL_LOAD_TIMEOUT_MS : 15_000);
}
function fail(error: string) { stopListening(); onError?.(error); }
function nativeError(raw: string | number) {
  if (!wantListening) return;
  const code = String(raw);
  if (['6','7','8','no_match','busy'].includes(code)) return;
  if (['9','10','not-allowed','permission_denied'].includes(code)) fail('Microphone permission denied. Enable it in device settings, then tap the mic.');
  else if (code === 'microphone_in_use') fail('Another recording is using the microphone. Finish it, then tap the mic.');
  else if (code === 'embedded_engine_unavailable') fail('The bundled offline speech engine is unavailable in this app installation.');
  else if (code === 'offline_speech_failed') fail('Offline speech could not load or capture audio. Tap the mic to try again.');
  else if (code !== '5') fail('Speech recognition is unavailable. Tap the mic to try again.');
}
export function installNativeSpeech(): void {
  if (!nativeSpeech() || typeof window === 'undefined') return;
  const previous = (window as any).__lifeosSpeech ?? {};
  (window as any).__lifeosSpeech = {
    ...previous,
    onSpeechResult: (text: string) => deliver(text, true),
    onSpeechPartial: (text: string) => deliver(text, false),
    onSpeechReady: recognizerReady,
    onSpeechBeginning: recognizerBeginning,
    onSpeechError: nativeError,
    onSpeechStopped: () => { if (wantListening && !recording) fail('Microphone stopped. Tap to start again.'); },
    onSpeechState: (state: string) => {
      if (!wantListening || recording) return;
      if (state === 'loading') {
        if (!loading) { loading = true; ready = false; waitForReady(true); }
        onState?.('loading');
      }
      if (state === 'listening' || state === 'ready') recognizerReady();
      else if (state === 'stopped' && wantListening && !recording) fail('Microphone stopped. Tap to start again.');
    },
  };
}
export function nativeTtsSpeak(text: string, onEnd?: (status?: string) => void): boolean {
  installNativeSpeech();
  const n = nativeSpeech();
  if (!n || typeof n.speak !== 'function') return false;
  ttsFinish?.();
  let ended = false;
  let watchdog: ReturnType<typeof setTimeout>;
  const finish = (status = 'done') => {
    if (ended) return;
    ended = true; clearTimeout(watchdog);
    if (ttsFinish === finish) {
      ttsFinish = null; delete (window as any).__lifeosSpeaking;
      if (status === 'cancelled') releaseSpeechMute();
      onEnd?.(status);
    }
  };
  ttsFinish = finish;
  (window as any).__lifeosSpeaking = text;
  watchdog = setTimeout(finish, 20_000);
  (window as any).__lifeosSpeech.onSpeakEnd = (status: string) => { finish(status); if (status === 'unavailable') unavailableHandler?.(); };
  try { n.speak(text); return true; } catch { finish(); return false; }
}
export function nativeTtsStop(): void { try { nativeSpeech()?.stopSpeak?.(); } catch { /* unavailable */ } ttsFinish?.(); if (typeof window !== 'undefined') delete (window as any).__lifeosSpeaking; }
export function nativeTtsSupported(): boolean { return typeof nativeSpeech()?.speak === 'function'; }
export function setTtsUnavailableHandler(fn: (() => void) | null): void { unavailableHandler = fn; }

function buildRecognizer(): any | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor(); r.continuous = true; r.interimResults = true; r.lang = 'en-US';
  r.onstart = recognizerReady;
  r.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) deliver(event.results[i][0].transcript, event.results[i].isFinal);
  };
  r.onerror = (event: any) => {
    if (['not-allowed','service-not-allowed','audio-capture'].includes(event.error)) fail('Microphone permission or input is unavailable.');
    else if (!['no-speech','aborted'].includes(event.error)) fail(`Speech recognition stopped (${event.error}).`);
  };
  r.onend = () => {
    ready = false;
    if (!wantListening || recording) return;
    restartTimer = setTimeout(() => {
      if (!wantListening || recording) return;
      try { r.start(); } catch { fail('Could not restart the microphone. Tap to try again.'); }
    }, 250);
  };
  return r;
}
export function startListening(heard: (text: string, final: boolean) => void, error?: (e: string) => void, state?: (s: VoiceListenState) => void, beginning?: () => void): boolean {
  onHeard = heard; onError = error ?? null; onState = state ?? null; onBeginning = beginning ?? null;
  if (wantListening) { onState?.(ready ? 'listening' : loading ? 'loading' : 'starting'); return true; }
  wantListening = true; ready = false; loading = false; recording = false; voicePerfMark('listen_start'); onState?.('starting');
  waitForReady(false);
  const n = nativeSpeech();
  if (n?.startContinuous) {
    installNativeSpeech();
    try { n.startContinuous(); return true; } catch { fail('The native microphone could not start. Tap to try again.'); return false; }
  }
  if (!recog) recog = buildRecognizer();
  if (!recog) { fail('Speech recognition is unavailable on this device.'); return false; }
  try { recog.start(); return true; } catch { fail('Could not start the microphone.'); return false; }
}
export function stopListening(): void {
  wantListening = false; ready = false; loading = false;
  if (restartTimer) clearTimeout(restartTimer);
  if (readyTimer) clearTimeout(readyTimer);
  try { nativeSpeech()?.stopContinuous?.(); } catch { /* unavailable */ }
  try { recog?.abort(); } catch { /* already stopped */ }
  onState?.('stopped');
}
export function pauseMicForRecording(): void {
  recording = true; ready = false; onState?.('stopped');
  if (restartTimer) clearTimeout(restartTimer);
  if (readyTimer) clearTimeout(readyTimer);
  try { nativeSpeech()?.stopContinuous?.(); recog?.abort(); } catch { /* unavailable */ }
}
export function resumeMicAfterRecording(): void {
  recording = false;
  if (!wantListening || !onHeard) return;
  const heard = onHeard, error = onError, state = onState, beginning = onBeginning;
  wantListening = false;
  startListening(heard, error ?? undefined, state ?? undefined, beginning ?? undefined);
}
export function isListening(): boolean { return wantListening; }

export type VoiceStage = 'listen_start' | 'recognizer_ready' | 'final_transcript' | 'reply_ready';
let perf: { t: number; stage: VoiceStage; ms: number | null }[] = [];
const starts: Partial<Record<VoiceStage, number>> = {};
export function voicePerfMark(stage: VoiceStage): void {
  const now = Date.now(); const anchor = stage === 'reply_ready' ? 'final_transcript' : 'listen_start';
  const ms = stage !== anchor && starts[anchor] != null ? now - starts[anchor]! : null;
  starts[stage] = now; perf = [...perf, { t: now, stage, ms }].slice(-12);
}
export function getVoicePerf(): { stage: VoiceStage; ms: number | null; ago: number }[] { return perf.map(p => ({ stage: p.stage, ms: p.ms, ago: Date.now()-p.t })); }

/** No private document bodies, IDs, media, categories or browsing history. */
export function buildAppContext(page: string, _pageParams: Record<string, string>): AppContext {
  const now = new Date();
  return { page, pageParams: {}, today: todayStr(), weekday: now.toLocaleDateString('en', { weekday: 'long' }), time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`, timezoneOffsetMinutes: now.getTimezoneOffset(), projects: [], categories: [], recentTaskTitles: [], todayTaskCount: dbState().tasks.filter(t => !t.deleted && !t.archived && t.due_date === todayStr() && t.status !== 'completed').length, routines: [] };
}
export interface CommandResult extends PlanResult { errorCode?: AssistantErrorCode }
export async function executeCommand(spoken: string, ctx: { page: string; pageParams: Record<string, string>; navigate: (p: any, params?: Record<string, string>) => void }, history: { role: 'user' | 'assistant'; content: string }[] = [], signal?: AbortSignal): Promise<CommandResult> {
  const cancelled = (): CommandResult => ({ ok: false, cancelled: true, message: '', results: [] });
  if (signal?.aborted || stopIntent(spoken)) return cancelled();
  if (!spoken.trim() || spoken.length > 500) return { ok: false, message: 'Please use a short, specific request.', results: [] };
  if (/^(?:what can you do|help|capabilities)[?.!]*$/i.test(spoken.trim())) return executePlan([{ name: 'capabilities', args: {} }], c => runAssistantTool(c, ctx), signal);
  let offlineReason = new AssistantError('ai_disabled', true);
  if (getAssistantSettings().useAI) {
    let plan: { reply: string; calls: ToolCall[] } | undefined;
    try { plan = await askBrain(spoken, buildAppContext(ctx.page, ctx.pageParams), history, signal); }
    catch (error) {
      const failure = assistantError(error);
      if (signal?.aborted || failure.code === 'cancelled') return cancelled();
      // Only a known preflight lack of AI can use the local parser. A remote
      // failure/invalid plan must never become an unintended local write.
      if (!failure.offlineAllowed) return { ok: false, message: failure.message, errorCode: failure.code, results: [] };
      offlineReason = failure;
    }
    if (signal?.aborted) return cancelled();
    if (plan) {
      if (plan.calls.length) return executePlan(plan.calls, c => runAssistantTool(c, ctx), signal);
      return { ok: !!plan.reply, message: plan.reply || 'What would you like to do?', results: [] };
    }
  }
  if (signal?.aborted) return cancelled();
  const intent = parseCommand(spoken);
  let call: ToolCall;
  switch (intent.kind) {
    case 'delete_task': case 'delete_reminder': case 'delete_note': call = { name: intent.kind, args: { title_match: intent.title_match } }; break;
    case 'add_task': {
      const p = parseQuickAdd(intent.text);
      call = { name: 'add_task', args: { title: p.title, due_date: intent.presetDate ?? p.due_date ?? todayStr(), due_time: (intent.presetTime ?? p.due_time)?.slice(0,5) ?? null, priority: intent.priority ?? p.priority ?? 'medium' } }; break;
    }
    case 'add_reminder':
      if (!intent.due_at) return { ok: false, message: 'What date and time should I use for that reminder?', results: [] };
      call = { name: 'add_reminder', args: { title: intent.text, due_at: intent.due_at } }; break;
    case 'add_note': call = { name: 'add_note', args: { title: intent.title, content: intent.content } }; break;
    case 'navigate': call = { name: 'navigate', args: { page: intent.page } }; break;
    case 'summarize_day': call = { name: 'summarize_day', args: {} }; break;
    default: return { ok: false, message: offlineReason.message, errorCode: offlineReason.code, results: [] };
  }
  return executePlan([call], c => runAssistantTool(c, ctx), signal);
}
export function extractWakeCommand(text: string, settings: AssistantSettings): string | null {
  const t = text.trim(); const wake = settings.wakeWord.trim();
  if (!wake) return null;
  const candidates = [wake, ...(wake.toLowerCase() === 'hey lifeos' ? ['hello lifeos'] : [])];
  for (const word of candidates) {
    if (!t.toLowerCase().startsWith(word.toLowerCase())) continue;
    const tail = t.slice(word.length);
    if (!tail || /^[\s,.!?]/.test(tail)) return tail.replace(/^[\s,.!?]+/, '');
  }
  return null;
}
