// LifeOS — alarm sound engine. Synthesized with WebAudio (no asset
// downloads): each "sound" is a short looping pattern. Alarms ring until
// the user turns them off — and once turned off, a shared dismissal record
// keeps them silent on every device until the next scheduled occurrence.

import { isKeyDismissed, dismissKey, syncDismissals } from './dismissals';
export { isKeyDismissed };

export type AlarmSoundId =
  | 'chime' | 'birdsong' | 'pulse' | 'marimba' | 'sunrise' | 'digital' | 'none';

export interface AlarmSoundDef {
  id: AlarmSoundId;
  label: string;
  hint: string;
}

export const ALARM_SOUNDS: AlarmSoundDef[] = [
  { id: 'chime', label: 'Chime', hint: 'Classic gentle bell' },
  { id: 'birdsong', label: 'Birdsong', hint: 'Soft nature chirps' },
  { id: 'marimba', label: 'Marimba', hint: 'Warm wooden taps' },
  { id: 'sunrise', label: 'Sunrise', hint: 'Rising morning arpeggio' },
  { id: 'pulse', label: 'Pulse', hint: 'Urgent double-beep' },
  { id: 'digital', label: 'Digital', hint: 'Classic alarm clock' },
  { id: 'none', label: 'Silent', hint: 'Notification only' },
];

let ctx: AudioContext | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let activeStop: (() => void) | null = null;
let currentSound: AlarmSoundId = 'chime';
const dismissed = new Set<string>();

export function setDefaultAlarmSound(id: AlarmSoundId) {
  if (ALARM_SOUNDS.some((s) => s.id === id)) currentSound = id;
}
export function getDefaultAlarmSound(): AlarmSoundId { return currentSound; }

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx!.state === 'suspended') void ctx!.resume();
    return ctx;
  } catch { return null; }
}

/**
 * Create + resume the AudioContext on the first real user gesture.
 *
 * Mobile browsers (iOS Safari, Android Chrome) start every AudioContext
 * suspended and only allow resume() during a user gesture. An alarm firing
 * before ANY tap since page load used to resume() a no-op and ring
 * SILENTLY (vibration only) — the "sometimes the alarm has no sound" bug.
 * Warming the context once at first touch makes every later fire audible.
 */
export function unlockAlarmAudio(): void {
  const c = audio();
  if (c && c.state === 'suspended') void c.resume().catch(() => { /* retried at fire time */ });
}
// One-time global gesture listener — cheap, and guarantees a runnable
// AudioContext for every alarm after the user's first interaction.
if (typeof window !== 'undefined') {
  for (const evt of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(evt, unlockAlarmAudio, { once: true, passive: true });
  }
}

function tone(c: AudioContext, freq: number, t0: number, dur: number, gain = 0.18, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// ---- vibration helper: buzz in sync with the alarm loop -------------------
let vibTimer: ReturnType<typeof setInterval> | null = null;
function startVibration() {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  stopVibration();
  const pattern = [600, 200, 600, 200, 1000];
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
  vibTimer = setInterval(() => { try { navigator.vibrate(pattern); } catch { /* ignore */ } }, 2600);
}
function stopVibration() {
  if (vibTimer) { clearInterval(vibTimer); vibTimer = null; }
  try { (navigator as any).vibrate?.(0); } catch { /* ignore */ }
}

/** One ~0.8s pattern of the given sound, layered for loudness. */
function playPattern(id: AlarmSoundId): (() => void) | undefined {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = 2.2; // global loudness boost
  master.connect(c.destination);
  const tone2 = (freq: number, at: number, dur: number, gain: number, type?: OscillatorType) => {
    // Fundamental + octave + saw sub-octave layered — reads much louder.
    const mk = (f: number, gGain: number, tp: OscillatorType) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = tp;
      o.frequency.setValueAtTime(f, at);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gGain, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    mk(freq, gain, type ?? 'sine');
    mk(freq * 2, gain * 0.5, type ?? 'sine');
    mk(freq / 2, gain * 0.35, 'sawtooth');
  };
  switch (id) {
    case 'chime':
      tone2(880, t, 0.6, 0.3); tone2(1320, t + 0.12, 0.5, 0.2); tone2(1760, t + 0.24, 0.4, 0.12);
      break;
    case 'birdsong':
      tone2(2200, t, 0.10, 0.22); tone2(2800, t + 0.12, 0.08, 0.18);
      tone2(2400, t + 0.30, 0.10, 0.22); tone2(3100, t + 0.42, 0.08, 0.15);
      break;
    case 'marimba':
      tone2(523, t, 0.25, 0.32, 'triangle'); tone2(659, t + 0.18, 0.25, 0.26, 'triangle');
      tone2(784, t + 0.36, 0.35, 0.22, 'triangle');
      break;
    case 'sunrise':
      [392, 494, 587, 784].forEach((f, i) => tone2(f, t + i * 0.14, 0.5, 0.18));
      break;
    case 'pulse':
      tone2(940, t, 0.09, 0.36, 'square'); tone2(940, t + 0.18, 0.09, 0.36, 'square');
      break;
    case 'digital':
      tone2(1000, t, 0.07, 0.34, 'sawtooth'); tone2(1000, t + 0.12, 0.07, 0.34, 'sawtooth');
      tone2(1000, t + 0.24, 0.07, 0.34, 'sawtooth');
      break;
    default:
      break;
  }
  return () => { master.disconnect(); };
}

export function isAlarmActive(): boolean { return activeStop !== null; }
export function wasDismissed(key: string): boolean { return dismissed.has(key); }
// ---- alarm state visible to the UI (in-app overlay) -----------------------
export interface AlarmMeta { key: string; title: string; body: string; sound: AlarmSoundId }
let current: AlarmMeta | null = null;
const alarmListeners = new Set<() => void>();
function notifyAlarmListeners() { alarmListeners.forEach((l) => l()); }
export function getAlarmState(): AlarmMeta | null { return current; }
export function subscribeAlarm(fn: () => void): () => void {
  alarmListeners.add(fn);
  return () => { alarmListeners.delete(fn); };
}

let snoozeTimer: ReturnType<typeof setTimeout> | null = null;
let snoozedKey: string | null = null;

/**
 * Start an alarm loop for `key`. Rings continuously (sound + vibration)
 * until the user turns it off — no auto-stop. Shows in `getAlarmState()`.
 * A key dismissed on ANY device (shared record) never rings here.
 */
export function startAlarm(key: string, sound?: AlarmSoundId, meta?: { title?: string; body?: string }) {
  const id = sound ?? currentSound;
  if (id === 'none') return;
  if (dismissed.has(key) || isKeyDismissed(key)) return;
  stopAlarm();
  let stopped = false;
  let stopPattern: (() => void) | undefined;

  current = { key, title: meta?.title ?? '⏰ Alarm', body: meta?.body ?? '', sound: id };
  const run = () => {
    if (stopped) return;
    // Native catch-up and cross-device sync populate the shared record even
    // if their live dismissal event was missed while the WebView was paused.
    if (isKeyDismissed(key)) { activeStop?.(); return; }
    stopPattern?.();
    stopPattern = playPattern(id);
    loopTimer = setTimeout(run, 1200);
  };
  run();
  startVibration();
  notifyAlarmListeners();

  // No cap — rings until turned off (Turn off / Snooze in the overlay or
  // notification), or a NEW alarm replaces it.
  activeStop = () => {
    stopped = true;
    stopPattern?.();
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    stopVibration();
    activeStop = null;
    current = null;
    notifyAlarmListeners();
  };
}

/**
 * In the Android shell the native AlarmSoundService loops independently of
 * this WebView — silencing only the WebAudio loop left it ringing with the
 * notification possibly already replaced/removed ("no way to turn it off").
 * Every web-side stop therefore also stops the native side for that key.
 */
function stopNativeAlarm(key?: string): void {
  if (!key) return;
  try { (window as any).LifeOSNative?.stopAlarm?.(key); } catch { /* not in the shell */ }
}

export function stopAlarm() {
  stopNativeAlarm(current?.key);
  activeStop?.();
}

/** Stop ringing now AND record the dismissal on the shared cross-device store
 * — "Turn off" means off everywhere, until the next scheduled occurrence. */
export function turnOffAlarm() {
  const key = current?.key;
  stopAlarm();
  if (key) {
    dismissed.add(key);
    dismissKey(key);
  }
}

/** Stop ringing now, then ring the same alarm again after `minutes`.
 * The native sound loop is stopped too (it can't be re-armed remotely —
 * the re-ring happens in-app on this device's timer). */
export function snoozeAlarm(minutes = 10) {
  const meta = current ? { ...current } : null;
  if (meta) {
    try { (window as any).LifeOSNative?.pauseAlarm?.(meta.key); } catch { /* not in the shell */ }
  }
  activeStop?.();
  if (snoozeTimer) { clearTimeout(snoozeTimer); snoozeTimer = null; }
  snoozedKey = meta?.key ?? null;
  if (meta) {
    snoozeTimer = setTimeout(() => {
      snoozeTimer = null;
      snoozedKey = null;
      startAlarm(meta.key, meta.sound, { title: meta.title, body: meta.body });
    }, minutes * 60_000);
  }
}

/** Permanently dismiss this alarm key — locally AND on the shared record,
 * so it never rings again on any device until its next occurrence. */
export function dismissAlarm(key: string) {
  if (!key) return;
  if (key === snoozedKey && snoozeTimer) {
    clearTimeout(snoozeTimer);
    snoozeTimer = null;
    snoozedKey = null;
  }
  dismissed.add(key);
  dismissKey(key); // persist cross-device (fire-and-forget)
  stopNativeAlarm(key);
  if (current?.key === key) activeStop?.();
}

// Android's notification delete intent reaches the visible WebView through
// MainActivity. Handle the exact key so swiping an old notification cannot
// stop a newer WebAudio alarm that has replaced it.
if (typeof window !== 'undefined') {
  window.addEventListener('lifeos-native-alarm-dismiss', (event: Event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key) dismissAlarm(key);
  });
  window.addEventListener('lifeos-native-alarm-snooze', (event: Event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    // Android already scheduled the retry. Do not call stopAlarm(): its
    // native bridge marks the key dismissed and would cancel that snooze.
    if (key && current?.key === key) activeStop?.();
  });
}

/** Pull the shared dismissal record into the local set (cross-device silencing). */
export async function loadSharedDismissals() {
  await syncDismissals();
}

/** Preview a sound once (settings / pickers). Safe during alarm. */
export function previewAlarmSound(id: AlarmSoundId) {
  playPattern(id);
}
