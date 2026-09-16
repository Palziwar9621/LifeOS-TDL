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

/** One ~0.8s pattern of the given sound. */
function playPattern(id: AlarmSoundId) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.02;
  switch (id) {
    case 'chime':
      tone(c, 880, t, 0.6, 0.16); tone(c, 1320, t + 0.12, 0.5, 0.10); tone(c, 1760, t + 0.24, 0.4, 0.06);
      break;
    case 'birdsong':
      tone(c, 2200, t, 0.10, 0.12); tone(c, 2800, t + 0.12, 0.08, 0.10);
      tone(c, 2400, t + 0.30, 0.10, 0.12); tone(c, 3100, t + 0.42, 0.08, 0.08);
      break;
    case 'marimba':
      tone(c, 523, t, 0.25, 0.18, 'triangle'); tone(c, 659, t + 0.18, 0.25, 0.15, 'triangle');
      tone(c, 784, t + 0.36, 0.35, 0.13, 'triangle');
      break;
    case 'sunrise':
      [392, 494, 587, 784].forEach((f, i) => tone(c, f, t + i * 0.14, 0.5, 0.10, 'sine'));
      break;
    case 'pulse':
      tone(c, 940, t, 0.09, 0.2, 'square'); tone(c, 940, t + 0.18, 0.09, 0.2, 'square');
      break;
    case 'digital':
      tone(c, 1000, t, 0.07, 0.18, 'sawtooth'); tone(c, 1000, t + 0.12, 0.07, 0.18, 'sawtooth');
      tone(c, 1000, t + 0.24, 0.07, 0.18, 'sawtooth');
      break;
    default:
      break;
  }
}

export function isAlarmActive(): boolean { return activeStop !== null; }
export function wasDismissed(key: string): boolean { return dismissed.has(key); }

/**
 * Start an alarm loop for `key`. Repeats the pattern every ~1.2s until
 * stopAlarm(key) is called, or 3 minutes pass (auto-stop, one final chime).
 */
export function startAlarm(key: string, sound?: AlarmSoundId) {
  const id = sound ?? currentSound;
  if (id === 'none') return;
  stopAlarm();
  if (dismissed.has(key)) return;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    playPattern(id);
    loopTimer = setTimeout(run, 1200);
  };
  run();

  const cap = setTimeout(() => stopAlarm(), 3 * 60 * 1000);
  activeStop = () => {
    stopped = true;
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    clearTimeout(cap);
    activeStop = null;
  };
}

export function stopAlarm() {
  activeStop?.();
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
