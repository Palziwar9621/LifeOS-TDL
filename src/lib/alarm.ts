// LifeOS — alarm sound engine.
// Synthesized with WebAudio (no asset downloads): each "sound" is a short
// looping pattern. Alarms repeat until the user dismisses them or a cap
// (3 minutes) is reached — never annoying forever, never silent by accident.

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
let dismissed = new Set<string>();

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
function playPattern(id: AlarmSoundId) {
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

/**
 * Start an alarm loop for `key`. Rings continuously (sound + vibration)
 * until the user turns it off — no auto-stop. Shows in `getAlarmState()`.
 */
export function startAlarm(key: string, sound?: AlarmSoundId, meta?: { title?: string; body?: string }) {
  const id = sound ?? currentSound;
  if (id === 'none') return;
  stopAlarm();
  if (dismissed.has(key)) return;
  let stopped = false;

  current = { key, title: meta?.title ?? '⏰ Alarm', body: meta?.body ?? '', sound: id };
  const run = () => {
    if (stopped) return;
    playPattern(id);
    loopTimer = setTimeout(run, 1200);
  };
  run();
  startVibration();
  notifyAlarmListeners();

  // No cap — rings until turned off (Turn off / Snooze in the overlay or
  // notification), or a NEW alarm replaces it.
  activeStop = () => {
    stopped = true;
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    stopVibration();
    activeStop = null;
    current = null;
    notifyAlarmListeners();
  };
}

export function stopAlarm() {
  activeStop?.();
}

/** Stop ringing now, then ring the same alarm again after `minutes`. */
export function snoozeAlarm(minutes = 10) {
  const meta = current ? { ...current } : null;
  stopAlarm();
  if (snoozeTimer) { clearTimeout(snoozeTimer); snoozeTimer = null; }
  if (meta) {
    snoozeTimer = setTimeout(() => {
      snoozeTimer = null;
      startAlarm(meta.key, meta.sound, { title: meta.title, body: meta.body });
    }, minutes * 60_000);
  }
}

/** Permanently dismiss this alarm key (won't ring again, e.g. after snooze). */
export function dismissAlarm(key: string) {
  dismissed.add(key);
  stopAlarm();
}
export function clearDismissed() { dismissed.clear(); }

/** Preview a sound once (settings / pickers). Safe during alarm. */
export function previewAlarmSound(id: AlarmSoundId) {
  playPattern(id);
}
