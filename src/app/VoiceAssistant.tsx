// Microphone is idle on every launch. Each session starts from a user gesture.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/components';
import { useApp } from './store';
import {
  speechSupported, startListening, stopListening, getAssistantSettings,
  saveAssistantSettings, extractWakeCommand, executeCommand, stopIntent,
  duckMicForSpeech, unduckMicAfterSpeech, releaseSpeechMute,
  nativeTtsSpeak, nativeTtsStop, nativeTtsSupported, setTtsUnavailableHandler,
  voicePerfMark, type VoiceListenState,
} from '../lib/voice';

export function VoiceAssistant() {
  const { page, pageParams, navigate, toast } = useApp();
  const [settings, setSettings] = useState(getAssistantSettings);
  const [micState, setMicState] = useState<VoiceListenState>('stopped');
  const [mode, setMode] = useState<'idle' | 'chat' | 'wake'>('idle');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const modeRef = useRef(mode);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const genRef = useRef(0);
  const speechGen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const mounted = useRef(true);
  const setSession = (next: typeof mode) => { modeRef.current = next; setMode(next); };

  const cutSpeech = useCallback(() => {
    speechGen.current++;
    nativeTtsStop();
    try { window.speechSynthesis?.cancel(); } catch { /* unavailable */ }
    delete (window as any).__lifeosSpeaking;
    releaseSpeechMute(); speakingRef.current = false; setSpeaking(false);
  }, []);
  const interrupt = useCallback(() => {
    abortRef.current?.abort(); abortRef.current = null;
    genRef.current++; busyRef.current = false; setBusy(false); cutSpeech();
  }, [cutSpeech]);
  const endSession = useCallback(() => {
    interrupt(); stopListening(); setMicState('stopped'); setSession('idle'); history.current = [];
  }, [interrupt]);
  const speak = useCallback((message: string) => {
    cutSpeech();
    const token = ++speechGen.current;
    const finish = (status?: string) => {
      if (token !== speechGen.current) return;
      speakingRef.current = false; setSpeaking(false);
      delete (window as any).__lifeosSpeaking;
      if (status === 'cancelled') releaseSpeechMute(); else unduckMicAfterSpeech();
    };
    speakingRef.current = true; setSpeaking(true); duckMicForSpeech();
    if (nativeTtsSupported() && nativeTtsSpeak(message, finish)) return;
    try {
      (window as any).__lifeosSpeaking = message;
      const u = new SpeechSynthesisUtterance(message);
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => /Google US English|Samantha|Aria|Jenny/.test(v.name)) ?? voices.find(v => v.lang.startsWith('en'));
      if (voice) u.voice = voice;
      u.rate = 1.08; u.onend = () => finish(); u.onerror = () => finish();
      window.speechSynthesis.speak(u);
      // Some WebViews expose a non-working synthesis API. Never stay ducked forever.
      setTimeout(finish, 20_000);
    } catch { finish(); }
  }, [cutSpeech]);

  const runCommand = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (stopIntent(text) === 'end') { endSession(); return; }
    if (stopIntent(text)) { interrupt(); return; }
    if (busyRef.current || speakingRef.current) interrupt();
    const generation = ++genRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    busyRef.current = true; setBusy(true);
    voicePerfMark('final_transcript');
    const previous = history.current.slice(-8);
    try {
      const result = await executeCommand(text, { page, pageParams, navigate }, previous, controller.signal);
      if (!mounted.current) return;
      if (generation !== genRef.current || result.cancelled) {
        // A DB helper already entered may finish. Report its receipt, never say
        // that a committed action was cancelled or silently undo it.
        if (result.results.length) {
          const receipt = `Earlier request finished: ${result.results.join(' ')}`;
          toast(receipt, 'info');
          if (modeRef.current !== 'idle') {
            history.current.push({ role: 'user', content: text }, { role: 'assistant', content: receipt });
            history.current = history.current.slice(-12);
          }
        }
        return;
      }
      voicePerfMark('reply_ready');
      toast(result.message, result.ok ? 'success' : 'info');
      speak(result.message);
      // Pending/cancelled requests never enter conversation memory as if they
      // were still instructions to execute on the next turn.
      history.current.push({ role: 'user', content: text }, { role: 'assistant', content: result.message });
      history.current = history.current.slice(-12);
    } catch {
      if (generation === genRef.current && !controller.signal.aborted) {
        const message = 'I couldn’t finish that request. Please check the app before trying again.';
        toast(message, 'error'); speak(message);
      }
    } finally {
      if (generation === genRef.current) { busyRef.current = false; setBusy(false); abortRef.current = null; }
    }
  }, [page, pageParams, navigate, speak, interrupt, endSession, toast]);

  const onTranscript = useCallback((text: string, final: boolean) => {
    if (modeRef.current === 'idle') return;
    const wakeCommand = extractWakeCommand(text, settings);
    const commandText = wakeCommand ?? text;
    const intent = stopIntent(commandText);
    if (intent === 'end' && final) { endSession(); return; }
    if (intent && (final || busyRef.current || speakingRef.current)) { interrupt(); return; }
    // Partials can interrupt immediately; no partial can execute a data action.
    const replacing = /^(?:please\s+)?(?:stop|wait|cancel|hold on|never ?mind)(?:\s*[,!.]|\s+(?:instead|add|create|open|show|delete|move|change)\b)/i.test(commandText);
    if ((busyRef.current || speakingRef.current) && (final || replacing)) interrupt();
    if (!final) return;
    if (modeRef.current === 'chat') {
      const request = replacing ? commandText.replace(/^(?:please\s+)?(?:stop|wait|cancel|hold on|never ?mind)[\s,.!]*(?:instead\s+)?/i, '') : commandText;
      if (request.trim()) void runCommand(request);
      return;
    }
    const command = wakeCommand;
    if (command !== null) { setSession('chat'); if (command) void runCommand(command); }
  }, [settings, runCommand, interrupt, endSession]);
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;
  const stableTranscript = useCallback((text: string, final: boolean) => transcriptRef.current(text, final), []);
  const stableError = useCallback((message: string) => { endSession(); toast(message, 'error'); }, [endSession, toast]);
  const speechBeginning = useCallback(() => {
    // Vosk emits this after accepted, non-echo words. Stop generation before
    // the final transcript arrives; only that final may start a new action.
    if (modeRef.current !== 'idle') interrupt();
  }, [interrupt]);
  const begin = useCallback((next: 'chat' | 'wake') => {
    if (!speechSupported() || !settings.enabled) return;
    endSession();
    if (next === 'wake') {
      // This explicit button consents to listening during this app session.
      // Recognition readiness, not dispatch, determines whether the mic is on.
      const consented = { ...getAssistantSettings(), listenContinuously: true, wakeConsent: true };
      saveAssistantSettings(consented); setSettings(consented);
    }
    setSession(next);
    if (!startListening(stableTranscript, stableError, setMicState, speechBeginning)) setSession('idle');
  }, [settings.enabled, endSession, stableTranscript, stableError, speechBeginning]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      const next = getAssistantSettings(); setSettings(next);
      if (!next.enabled || (modeRef.current === 'wake' && (!next.wakeConsent || !next.listenContinuously))) endSession();
    };
    window.addEventListener('lifeos-assistant-settings', changed);
    window.addEventListener('storage', changed);
    const hidden = () => { if (document.hidden) endSession(); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false; abortRef.current?.abort(); genRef.current++; speechGen.current++;
      stopListening(); nativeTtsStop(); window.speechSynthesis?.cancel(); releaseSpeechMute();
      window.removeEventListener('lifeos-assistant-settings', changed);
      window.removeEventListener('storage', changed);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [endSession]);
  useEffect(() => { setTtsUnavailableHandler(() => toast('Spoken audio is unavailable. Your result is shown in the app.', 'info')); return () => setTtsUnavailableHandler(null); }, [toast]);

  if (!speechSupported() || !settings.enabled) return null;
  const active = mode !== 'idle';
  const status = micState === 'loading' ? 'Loading offline speech model — first start may take up to 90 seconds' : busy ? 'Thinking' : speaking ? 'Speaking' : micState === 'starting' ? 'Starting microphone' : active && micState === 'stopped' ? 'Microphone paused' : mode === 'wake' ? `Waiting for “${settings.wakeWord}”` : active ? 'Listening' : 'Microphone off';
  return <div className="fixed z-40 bottom-20 right-4 flex flex-col items-end gap-2 md:bottom-6">
    {mode === 'idle' && <button className="btn-secondary btn-sm" title="Enable microphone and listen for your wake phrase while this app is visible" onClick={() => begin('wake')}>Enable wake mode</button>}
    <span className="max-w-xs rounded-lg bg-slate-900 px-2 py-1 text-right text-xs text-white" role="status" aria-live="polite">{status}</span>
    <button aria-label={active ? 'Stop voice assistant' : 'Start voice chat'} aria-pressed={active} onClick={() => active ? endSession() : begin('chat')}
      className={`h-12 w-12 rounded-full shadow-lg flex items-center justify-center ring-1 ring-white/20 ${busy || speaking ? 'animate-pulse' : ''}`}
      style={{ background: busy || speaking ? '#4f46e5' : active ? '#059669' : '#0f172a', color: '#fff' }} title={active ? 'Stop listening and pending work' : 'Start voice chat'}>
      <Icon name="mic" className="h-5 w-5" />
    </button>
  </div>;
}
