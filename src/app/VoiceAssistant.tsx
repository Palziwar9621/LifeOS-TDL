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
  nativeTtsSpeak, nativeTtsStop, nativeTtsSupported,
  type AssistantSettings,
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
  const { page, pageParams, navigate } = useApp();
  const supported = speechSupported();
  const [settings, setSettings] = useState<AssistantSettings>(() => getAssistantSettings());
  const [listening, setListening] = useState(false);
  const [conv, setConv] = useState(false);          // conversation session active
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);                 // auto-start guard (StrictMode double-effect)

  // Conversation memory (this session only, in-memory — never persisted).
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);

  // Speak WITHOUT captions. Ducks the mic while talking (anti-feedback), then
  // hands the mic back after a short tail. On the Android shell there is no
  // window.speechSynthesis — replies go through the native TTS bridge instead.
  const speak = useCallback((msg: string) => {
    duckMicForSpeech();
    if (nativeTtsSupported() && typeof window !== 'undefined' && !window.speechSynthesis) {
      const ok = nativeTtsSpeak(msg, () => unduckMicAfterSpeech());
      if (ok) return;
      // native path failed — fall through to web speech (and unduck there)
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.05;
      u.pitch = 1.0;
      u.onend = () => unduckMicAfterSpeech();
      u.onerror = () => unduckMicAfterSpeech();
      window.speechSynthesis.speak(u);
    } catch {
      unduckMicAfterSpeech(); // TTS unavailable — hand the mic back immediately
    }
  }, []);

  const runCommand = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
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
      historyRef.current.push({ role: 'user', content: text });
      const res = await executeCommand(text, { page, pageParams, navigate }, historyRef.current);
      speak(res.message);
      historyRef.current.push({ role: 'assistant', content: res.message });
      if (historyRef.current.length > 12) historyRef.current.splice(0, historyRef.current.length - 12);
    } catch (e: any) {
      speak(e?.message ?? 'Something went wrong — check your connection');
    } finally {
      setBusy(false);
    }
  }, [busy, page, pageParams, navigate, speak]);

  const onTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!isFinal) return;             // no visuals for partials — it's a voice chat
    if (busy) return;
    if (conv) {
      void runCommand(text);
      return;
    }
    const cmd = extractWakeCommand(text, settings);
    if (cmd) {
      setConv(true);
      void runCommand(cmd);
    } else if (cmd === '') {
      setConv(true);
      speak("Hey! I'm listening.");
    }
  }, [conv, busy, settings, runCommand, speak]);

  // Cleanup on unmount
  useEffect(() => () => { stopListening(); }, []);

  // Always-current transcript handler (stale-closure guard; see voice.ts).
  const transcriptRef = useRef(onTranscript);
  useEffect(() => { transcriptRef.current = onTranscript; }, [onTranscript]);
  const stableTranscript = useCallback((t: string, isFinal: boolean) => transcriptRef.current(t, isFinal), []);
  const stableError = useCallback((err: string) => { if (!busy) setListening(false); }, [busy]);

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
      speak("Hey! I'm listening.");
      const ok = startListening(stableTranscript, stableError);
      setListening(ok);
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
