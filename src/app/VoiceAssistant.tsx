// LifeOS — Voice assistant UI: floating mic button + live listening overlay.
// Wake word ("Hey LifeOS") arms the assistant while the app is open; a tap
// on the mic starts a one-shot command. Responses are spoken back via
// speech synthesis and shown as a caption.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/components';
import { useApp } from './store';
import {
  speechSupported, startListening, stopListening, isListening,
  getAssistantSettings, saveAssistantSettings, extractWakeCommand, executeCommand,
  type AssistantSettings,
} from '../lib/voice';

export function VoiceAssistant() {
  const { page, pageParams, navigate, toast } = useApp();
  const supported = speechSupported();
  const [settings, setSettings] = useState<AssistantSettings>(() => getAssistantSettings());
  const [listening, setListening] = useState(false);
  const [armed, setArmed] = useState(false);        // wake word heard, waiting for command
  const [caption, setCaption] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const armedTimer = useRef<number | null>(null);

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
    try {
      const res = await executeCommand(text, { page, pageParams, navigate });
      speak(res.message);
      if (res.ok) toast(res.message, 'success');
    } catch (e: any) {
      speak(e?.message ?? 'Something went wrong — check your connection');
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }, [busy, page, pageParams, navigate, speak, toast]);

  const onTranscript = useCallback((text: string, isFinal: boolean) => {
    // Show partial transcripts live so it's obvious the mic is hearing you.
    if (!isFinal) {
      if (text && text.length > 2) setCaption(text);
      return;
    }
    if (busy) return;
    if (armed) {
      // Command mode: everything spoken is a command.
      setArmed(false);
      void runCommand(text);
      return;
    }
    const cmd = extractWakeCommand(text, settings);
    if (cmd === null) return;
    if (cmd) {
      void runCommand(cmd);            // "hey lifeos add task…"
    } else {
      setArmed(true);                  // "hey lifeos" alone
      speak('Listening…');
      if (armedTimer.current) window.clearTimeout(armedTimer.current);
      armedTimer.current = window.setTimeout(() => setArmed(false), 10_000);
    }
  }, [armed, busy, settings, runCommand, speak]);

  const toggleContinuous = useCallback(() => {
    if (!supported) return;
    if (isListening()) {
      stopListening();
      setListening(false);
      setArmed(false);
    } else {
      const ok = startListening(onTranscript, (err) => {
        speak(err);
        setListening(false);
      });
      setListening(ok);
      if (ok) speak('Voice assistant on');
    }
  }, [supported, onTranscript, speak]);

  const oneShot = useCallback(() => {
    if (!supported || busy) return;
    setArmed(true);
    speak('Listening…');
    startListening(onTranscript, (err) => { speak(err); });
    setListening(true);
    if (armedTimer.current) window.clearTimeout(armedTimer.current);
    armedTimer.current = window.setTimeout(() => setArmed(false), 12_000);
  }, [supported, busy, onTranscript, speak]);

  // Mic button = simple toggle: tap to talk, tap again to stop.
  const micTap = useCallback(() => {
    if (isListening()) {
      stopListening();
      setListening(false);
      setArmed(false);
      setCaption(null);
    } else {
      oneShot();   // single start path — double-start caused busy errors
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { stopListening(); }, []);

  // Persist settings changes
  const updateSettings = (patch: Partial<AssistantSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAssistantSettings(next);
    if (!next.enabled && isListening()) { stopListening(); setListening(false); }
  };

  if (!supported || !settings.enabled) return null;

  const state = busy ? 'working' : armed ? 'armed' : listening ? 'awake' : 'idle';

  return (
    <>
      {/* Floating mic — explicit colors (theme classes rendered black/invisible) */}
      <button
        aria-label="Voice assistant"
        onClick={micTap}
        style={state === 'armed' || state === 'working'
          ? { background: '#4f46e5', color: '#fff' }
          : state === 'awake'
            ? { background: '#10b981', color: '#fff' }
            : { background: '#0f172a', color: '#e2e8f0' }}
        className={`fixed z-40 bottom-20 right-4 h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition md:bottom-6
          ${state === 'armed' ? 'animate-pulse' : ''} ring-1 ring-white/20`}
      >
        <Icon name="mic" className="h-5 w-5" />
      </button>

      {/* Caption */}
      {(caption || armed) && (
        <div className="fixed z-40 bottom-36 left-1/2 -translate-x-1/2 max-w-[92vw] rounded-2xl bg-slate-900/90 text-white text-sm px-4 py-2.5 shadow-xl animate-slide-up md:bottom-20">
          {caption ?? 'Listening…'}
        </div>
      )}
    </>
  );
}
