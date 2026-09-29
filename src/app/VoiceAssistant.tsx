// LifeOS — Voice assistant UI: floating mic button + live conversation overlay.
//
// Interaction model (conversation mode):
//  • When the assistant is enabled in Settings, listening starts automatically
//    when the app opens — no mic tap needed.
//  • Saying the wake word ("hello lifeos" / configured phrase) opens a
//    conversation session. Every final transcript after that is treated as a
//    command — no wake word needed again.
//  • The session stays open until the user says an off phrase
//    ("turn off the assistant" / "stop listening" / "goodbye") or taps the
//    mic to stop it manually. There is no idle timeout that drops you back
//    to wake-word mode.
//  • Every command gets a spoken reply + visible caption; the heard command
//    is echoed in the caption so it's obvious what the assistant caught.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/components';
import { useApp } from './store';
import {
  speechSupported, startListening, stopListening, isListening,
  getAssistantSettings, saveAssistantSettings, extractWakeCommand, executeCommand,
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

export function VoiceAssistant() {
  const { page, pageParams, navigate, toast } = useApp();
  const supported = speechSupported();
  const [settings, setSettings] = useState<AssistantSettings>(() => getAssistantSettings());
  const [listening, setListening] = useState(false);
  const [conv, setConv] = useState(false);          // conversation session active
  const [caption, setCaption] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);                 // auto-start guard (StrictMode double-effect)

  const speak = useCallback((msg: string) => {
    setCaption(msg);
    try {
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch { /* TTS unavailable — caption still shows */ }
    window.setTimeout(() => setCaption((c) => (c === msg ? null : c)), 6000);
  }, []);

  const runCommand = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setCaption(text);            // echo what was heard
    try {
      // Turn-off phrases end the session instead of hitting the brain.
      if (matchesOffPhrase(text)) {
        setConv(false);
        speak('Assistant off. Tap the mic to talk again.');
        stopListening();
        setListening(false);
        return;
      }
      const res = await executeCommand(text, { page, pageParams, navigate });
      speak(res.message);
      if (res.ok) toast(res.message, 'success');
    } catch (e: any) {
      speak(e?.message ?? 'Something went wrong — check your connection');
    } finally {
      setBusy(false);
    }
  }, [busy, page, pageParams, navigate, speak, toast]);

  const onTranscript = useCallback((text: string, isFinal: boolean) => {
    // Partials show live so it's obvious the mic is hearing you.
    if (!isFinal) {
      if (text && text.length > 2) setCaption(text);
      return;
    }
    if (busy) return;
    // In a conversation session, everything spoken is a command — wake word
    // not required again. (The stale-closure bug that swallowed finals was
    // fixed by routing callbacks through refs; onTranscript only runs fresh.)
    if (conv) {
      void runCommand(text);
      return;
    }
    const cmd = extractWakeCommand(text, settings);
    if (cmd === null) return;                     // no wake word → ignore quietly
    if (cmd) {
      setConv(true);                              // "hello … add task" → chat mode on
      void runCommand(cmd);
    } else {
      setConv(true);                              // wake word alone → greet
      speak('I\'m listening. What can I do for you?');
    }
  }, [conv, busy, settings, runCommand, speak]);

  // Cleanup on unmount
  useEffect(() => () => { stopListening(); }, []);

  // Always-current transcript handler. The recognizer (web or native) keeps
  // whatever callback it was started with, but `onTranscript` is recreated on
  // every render (it reads `conv`/`busy`/`settings`). Without this ref the
  // final result was evaluated against a stale closure where conv=false, so
  // the command was silently swallowed: input visible, no output. Route every
  // callback through the ref so it always runs the latest handler.
  const transcriptRef = useRef(onTranscript);
  useEffect(() => { transcriptRef.current = onTranscript; }, [onTranscript]);
  const stableTranscript = useCallback((t: string, isFinal: boolean) => transcriptRef.current(t, isFinal), []);
  const stableError = useCallback((err: string) => { speak(err); setListening(false); }, [speak]);

  // Start listening once when the app opens and the assistant is enabled.
  // (Auto-start = the wake word works without tapping the mic first.)
  useEffect(() => {
    if (!supported || !settings.enabled || startedRef.current) return;
    startedRef.current = true;
    const ok = startListening(stableTranscript, stableError);
    setListening(ok);
  }, [supported, settings.enabled, stableTranscript, stableError]);

  // Mic button = simple toggle: tap to start a session, tap again to stop.
  const micTap = useCallback(() => {
    if (isListening()) {
      stopListening();
      setListening(false);
      setConv(false);
      setCaption(null);
    } else {
      setConv(true);
      speak('I\'m listening. What can I do for you?');
      const ok = startListening(stableTranscript, stableError);
      setListening(ok);
    }
  }, [stableTranscript, stableError, speak]);

  // Persist settings changes; stop listening when disabled.
  const updateSettings = (patch: Partial<AssistantSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAssistantSettings(next);
    if (!next.enabled && isListening()) { stopListening(); setListening(false); setConv(false); }
  };
  void updateSettings; // settings live in SettingsPage; kept for future use

  if (!supported || !settings.enabled) return null;

  const state = busy ? 'working' : conv ? 'conv' : listening ? 'awake' : 'idle';

  return (
    <>
      {/* Floating mic — explicit colors (theme classes rendered black/invisible) */}
      <button
        aria-label="Voice assistant"
        onClick={micTap}
        style={state === 'conv' || state === 'working'
          ? { background: '#4f46e5', color: '#fff' }
          : state === 'awake'
            ? { background: '#10b981', color: '#fff' }
            : { background: '#0f172a', color: '#e2e8f0' }}
        className={`fixed z-40 bottom-20 right-4 h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition md:bottom-6
          ${state === 'working' ? 'animate-pulse' : ''} ring-1 ring-white/20`}
        title={state === 'idle' ? 'Start voice chat' : 'Stop voice assistant'}
      >
        <Icon name="mic" className="h-5 w-5" />
      </button>

      {/* Caption */}
      {(caption || conv) && (
        <div className="fixed z-40 bottom-36 left-1/2 -translate-x-1/2 max-w-[92vw] rounded-2xl bg-slate-900/90 text-white text-sm px-4 py-2.5 shadow-xl animate-slide-up md:bottom-20">
          {caption ?? 'Listening — say a command, or "turn off assistant" to stop'}
        </div>
      )}
    </>
  );
}
