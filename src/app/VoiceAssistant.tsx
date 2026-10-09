// LifeOS — Voice assistant UI: floating mic button + hands-free conversation.
//
// Interaction model (voice chat, like talking to a person):
//  • When enabled in Settings, listening starts automatically with the app.
//  • Wake word ("hello lifeos") opens a session; everything after that is
//    conversation — no wake word needed again until the session ends.
//  • While the assistant speaks, the mic is HARD-MUTED (see voice.ts ducking)
//    so it never transcribes its own voice — no more feedback squeal, and no
//    more commands eaten by echo.
//  • Conversation history is kept and sent to the brain, so follow-ups like
//    "move it to friday" or "and add milk too" work.
//  • No on-screen subtitles: this is a voice chat. The mic button color shows
//    state (dark=idle, green=listening, indigo=thinking/speaking).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/components';
import { useApp } from './store';
import {
  speechSupported, startListening, stopListening, isListening,
  getAssistantSettings, extractWakeCommand, executeCommand,
  duckMicForSpeech, unduckMicAfterSpeech,
  nativeTtsSpeak, nativeTtsStop, nativeTtsSupported, setTtsUnavailableHandler,
  voicePerfMark, type AssistantSettings,
} from '../lib/voice';

// Phrases that end the conversation session (checked case-insensitively).
const OFF_PHRASES = [
  'turn off the assistant', 'turn off assistant', 'stop listening',
  'stop the assistant', 'goodbye', 'bye lifeos', 'stop assistant',
];

function matchesOffPhrase(t: string): boolean {
  const x = t.toLowerCase().replace(/[.,!?]+$/, '').trim();
  return OFF_PHRASES.some((p) => x === p || (x.length > p.length && x.includes(p) && x.length < p.length + 16));
}

// Pick a natural voice: prefer a female en-US conversational voice when the
// OS has one, else any en voice. Falls back to whatever TTS offers.
function pickVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    const prefer = ['Google US English', 'Samantha', 'Microsoft Aria', 'Microsoft Jenny', 'Zira', 'Google UK English Female'];
    for (const name of prefer) {
      const v = voices.find((x) => x.name.includes(name));
      if (v) return v;
    }
    return voices.find((v) => v.lang.startsWith('en')) ?? voices[0] ?? null;
  } catch { return null; }
}

export function VoiceAssistant() {
  const { page, pageParams, navigate, toast } = useApp();
  const supported = speechSupported();
  const [settings, setSettings] = useState<AssistantSettings>(() => getAssistantSettings());
  const [listening, setListening] = useState(false);
  const [conv, setConv] = useState(false);          // conversation session active
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);                 // auto-start guard (StrictMode double-effect)

  // Conversation memory (this session only, in-memory — never persisted).
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);

  // Speak WITHOUT captions. Ducks the mic while talking (anti-feedback), then
  // hands the mic back after a short tail. The Android WebView EXPOSES
  // window.speechSynthesis but it silently does nothing there — so when the
  // native TTS bridge exists we always use it first; browsers never have the
  // bridge and keep using Web Speech.
  const speak = useCallback((msg: string) => {
    duckMicForSpeech();
    if (nativeTtsSupported()) {
      const ok = nativeTtsSpeak(msg, () => unduckMicAfterSpeech());
      if (ok) return;
      // native path failed — fall through to web speech (and unduck there)
    }
    try {
      window.speechSynthesis.cancel();
      try { (window as any).__lifeosSpeaking = msg; } catch { /* ignore */ }
      const u = new SpeechSynthesisUtterance(msg);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.12;   // slightly brisker — shorter replies, snappier feel
      u.pitch = 1.0;
      u.onend = () => { try { delete (window as any).__lifeosSpeaking; } catch { /* ignore */ } unduckMicAfterSpeech(); };
      u.onerror = () => { try { delete (window as any).__lifeosSpeaking; } catch { /* ignore */ } unduckMicAfterSpeech(); };
      window.speechSynthesis.speak(u);
    } catch {
      try { delete (window as any).__lifeosSpeaking; } catch { /* ignore */ }
      unduckMicAfterSpeech(); // TTS unavailable — hand the mic back immediately
    }
  }, []);

  /** CUT the assistant off mid-sentence and take the user's next words. */
  const cutSpeech = useCallback(() => {
    if (nativeTtsSupported()) nativeTtsStop();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { delete (window as any).__lifeosSpeaking; } catch { /* ignore */ }
    unduckMicAfterSpeech();
  }, []);

  // Monotonic token for the in-flight command: a barge-in bumps it, the
  // running loop checks and abandons stale work (tool results discarded,
  // reply not spoken).
  const genRef = useRef(0);
  // busy as a ref too: barge-in handlers run between React commits and a
  // state-dependent `busy` guard would read stale(true) and swallow the
  // user's interrupt sentence.
  const busyRef = useRef(false);

  const runCommand = useCallback(async (text: string) => {
    if (!text.trim() || busyRef.current) return;
    const gen = ++genRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      if (matchesOffPhrase(text)) {
        setConv(false);
        speak('Okay, talk to you later. Tap the mic when you need me.');
        stopListening();
        setListening(false);
        historyRef.current = [];
        return;
      }
      voicePerfMark('final_transcript');
      historyRef.current.push({ role: 'user', content: text });
      const res = await executeCommand(text, { page, pageParams, navigate }, historyRef.current);
      if (gen !== genRef.current) return;   // barge-in during processing — drop the stale reply
      voicePerfMark('reply_ready');
      speak(res.message);
      historyRef.current.push({ role: 'assistant', content: res.message });
      if (historyRef.current.length > 12) historyRef.current.splice(0, historyRef.current.length - 12);
    } catch (e: any) {
      if (gen === genRef.current) speak(e?.message ?? 'Something went wrong — check your connection');
    } finally {
      if (gen === genRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [page, pageParams, navigate, speak]);

  const onTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!isFinal) return;             // no visuals for partials — it's a voice chat
    const t = text.trim();
    if (!t) return;
    // BARGE-IN: while the assistant is speaking (mic ducked), voice.ts only
    // forwards deliberate interrupt phrases — handle them here: cut the
    // speech, cancel in-flight work, and take the user's words now.
    const muted = !!(window as any).__lifeosMicMuted;
    if (muted) {
      cutSpeech();
      genRef.current++;               // abort any in-flight command work
      busyRef.current = false;
      setBusy(false);
      // The interrupt sentence itself is often "stop, don't do X" + the real
      // substitution in the same breath. Feed it through as a normal command:
      // the brain's prompt treats it as the user replacing the previous ask.
      setConv(true);
      void runCommand(t);
      return;
    }
    if (busy) return;
    if (conv) {
      void runCommand(t);
      return;
    }
    const cmd = extractWakeCommand(t, settings);
    if (cmd) {
      setConv(true);
      void runCommand(cmd);
    } else if (cmd === '') {
      setConv(true);
      speak("Hey! I'm listening.");
    }
  }, [conv, busy, settings, runCommand, speak, cutSpeech]);

  // Cleanup on unmount
  useEffect(() => () => { stopListening(); }, []);

  // If the Android shell reports no working TTS engine, say so loudly —
  // silence here used to look like "the assistant stopped talking" with no clue why.
  useEffect(() => {
    setTtsUnavailableHandler(() => {
      toast("Speech engine missing on this device — install a TTS engine (e.g. Google Speech Services) or replies can't be spoken.", 'error');
    });
    return () => setTtsUnavailableHandler(null);
  }, [toast]);

  // Always-current transcript handler (stale-closure guard; see voice.ts).
  const transcriptRef = useRef(onTranscript);
  useEffect(() => { transcriptRef.current = onTranscript; }, [onTranscript]);
  const stableTranscript = useCallback((t: string, isFinal: boolean) => transcriptRef.current(t, isFinal), []);
  const stableError = useCallback((_err: string) => { setListening(false); }, []);

  // Start listening once when the app opens and the assistant is enabled.
  useEffect(() => {
    if (!supported || !settings.enabled || startedRef.current) return;
    startedRef.current = true;
    const ok = startListening(stableTranscript, stableError);
    setListening(ok);
  }, [supported, settings.enabled, stableTranscript, stableError]);

  // Mic button = toggle: tap to start a session, tap again to stop.
  const micTap = useCallback(() => {
    if (isListening()) {
      stopListening();
      setListening(false);
      setConv(false);
    } else {
      setConv(true);
      // Start the recognizer FIRST, then greet: the greeting ducks/pauses the
      // mic anyway, so this order lets engine init overlap with speech instead
      // of waiting for the whole greeting to finish before listening begins.
      const ok = startListening(stableTranscript, stableError);
      setListening(ok);
      speak("Hey! I'm listening.");
    }
  }, [stableTranscript, stableError, speak]);

  if (!supported || !settings.enabled) return null;

  const speaking = typeof window !== 'undefined' && mutedNow();
  const state = busy || speaking ? 'working' : conv || listening ? 'conv' : 'idle';

  return (
    <button
      aria-label="Voice assistant"
      onClick={micTap}
      style={state === 'working'
        ? { background: '#4f46e5', color: '#fff' }
        : state === 'conv'
          ? { background: '#10b981', color: '#fff' }
          : { background: '#0f172a', color: '#e2e8f0' }}
      className={`fixed z-40 bottom-20 right-4 h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition md:bottom-6
        ${state === 'working' ? 'animate-pulse' : ''} ring-1 ring-white/20`}
      title={state === 'idle' ? 'Start voice chat' : 'Stop voice assistant'}
    >
      <Icon name="mic" className="h-5 w-5" />
    </button>
  );
}

// Small helper so the render doesn't re-render every tick; mic-mute state is
// module-level in voice.ts, sampled at render time only.
function mutedNow(): boolean {
  try { return !!(window as any).__lifeosMicMuted; } catch { return false; }
}
