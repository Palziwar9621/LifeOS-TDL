import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantWakeLifecycle } from '../src/lib/assistantWake.ts';
import {
  getAssistantSettings, saveAssistantSettings, speechSupported,
  startListening, stopListening, isListening, type AssistantSettings,
} from '../src/lib/voice.ts';

const storage = new Map<string, string>();
let writes = 0;
let nativeStarts = 0;
let win: any;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  storage.clear(); writes = 0; nativeStarts = 0;
  win = new EventTarget();
  win.LifeOSSpeech = { startContinuous() { nativeStarts++; }, stopContinuous() {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); writes++; },
  } });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  stopListening();
});
const flush = async () => { await Promise.resolve(); };
const patch = (values: Partial<AssistantSettings>) => saveAssistantSettings({ ...getAssistantSettings(), ...values });
const consent = () => patch({ wakeConsent: true, listenContinuously: true });

// Exercise the same lifecycle controller used by VoiceAssistant, with real
// settings events and voice.ts recognition/readiness/error callbacks.
function app(initiallyVisible = true) {
  let visible = initiallyVisible;
  let mode: 'idle' | 'wake' | 'chat' = 'idle';
  const starts: string[] = [];
  const states: string[] = [];
  const errors: string[] = [];
  const lifecycle = createAssistantWakeLifecycle({
    settings: getAssistantSettings,
    visible: () => visible,
    supported: speechSupported,
    start(next) {
      stopListening(); mode = next; starts.push(next);
      return startListening(() => {}, message => {
        errors.push(message); lifecycle.fail();
      }, state => states.push(state));
    },
    stop() { mode = 'idle'; stopListening(); },
  });
  const changed = () => lifecycle.settingsChanged();
  win.addEventListener('lifeos-assistant-settings', changed);
  win.addEventListener('storage', changed);
  lifecycle.mount();
  const destroy = () => {
    lifecycle.unmount();
    win.removeEventListener('lifeos-assistant-settings', changed);
    win.removeEventListener('storage', changed);
  };
  cleanups.push(destroy);
  return {
    lifecycle, starts, states, errors, destroy,
    get mode() { return mode; },
    visibility(next: boolean) {
      visible = next;
      lifecycle.settingsChanged();
      lifecycle.visibilityChanged();
    },
  };
}

test('new and legacy users without explicit consent stay idle on launch and resume', async () => {
  for (const saved of [{}, { enabled: true, listenContinuously: true }, { wakeConsent: true, listenContinuously: false }]) {
    storage.set('lifeos.assistant', JSON.stringify(saved));
    const instance = app(); await flush();
    instance.visibility(false); instance.visibility(true); await flush();
    assert.equal(instance.mode, 'idle'); assert.deepEqual(instance.starts, []);
    instance.destroy();
  }
  assert.equal(nativeStarts, 0); assert.equal(writes, 0);
});

test('explicit wake consent persists across recreation and resumes waiting, never chat', async () => {
  const first = app(); await flush();
  consent(); first.lifecycle.begin('wake'); await flush();
  assert.deepEqual(first.starts, ['wake']); // the settings event must not double-start
  first.lifecycle.begin('chat');
  first.destroy();
  const saved = storage.get('lifeos.assistant');
  const second = app(); await flush();
  assert.equal(second.mode, 'wake'); assert.deepEqual(second.starts, ['wake']);
  assert.equal(second.states.at(-1), 'starting'); // dispatch is not readiness
  win.__lifeosSpeech.onSpeechReady();
  assert.equal(second.states.at(-1), 'listening');
  assert.equal(storage.get('lifeos.assistant'), saved); assert.equal(writes, 1);
});

test('StrictMode setup/cleanup/setup cancels the first queued start', async () => {
  consent();
  const instance = app();
  instance.lifecycle.unmount(); instance.lifecycle.mount();
  await flush();
  assert.deepEqual(instance.starts, ['wake']); assert.equal(nativeStarts, 1);
  assert.equal(isListening(), true);
});

test('unmount before the queued launch leaves the microphone off', async () => {
  consent(); const instance = app(); instance.destroy(); await flush();
  assert.deepEqual(instance.starts, []); assert.equal(isListening(), false);
});

test('hidden launch waits; hiding stops chat and foreground return starts only wake', async () => {
  consent(); const instance = app(false); await flush();
  assert.equal(instance.mode, 'idle');
  instance.visibility(true); await flush();
  assert.equal(instance.mode, 'wake');
  instance.lifecycle.begin('chat'); instance.visibility(false);
  assert.equal(instance.mode, 'idle'); assert.equal(isListening(), false);
  instance.visibility(true); instance.visibility(true); await flush();
  assert.deepEqual(instance.starts, ['wake', 'chat', 'wake']);
  assert.equal(writes, 1);
});

test('manual stop does not revoke consent or restart on rerenders/settings noise', async () => {
  consent(); const instance = app(); await flush();
  instance.lifecycle.stop();
  patch({ wakeWord: 'hello lifeos', useAI: false });
  for (let i = 0; i < 5; i++) {
    instance.lifecycle.settingsChanged(); instance.visibility(true);
  }
  await flush();
  assert.equal(instance.mode, 'idle'); assert.deepEqual(instance.starts, ['wake']);
  assert.equal(getAssistantSettings().wakeConsent, true);
  assert.equal(getAssistantSettings().listenContinuously, true);
  instance.visibility(false); instance.visibility(true); await flush();
  assert.deepEqual(instance.starts, ['wake', 'wake']);
});

test('Settings opt-out immediately stops and stays off across resume and recreation', async () => {
  consent(); const instance = app(); await flush();
  patch({ wakeConsent: false, listenContinuously: false });
  assert.equal(isListening(), false); assert.equal(instance.mode, 'idle');
  instance.visibility(false); instance.visibility(true); await flush();
  assert.deepEqual(instance.starts, ['wake']);
  instance.destroy(); const next = app(); await flush();
  assert.deepEqual(next.starts, []);
});

test('disable cancels a queued start, including cross-tab storage events', async () => {
  consent(); const instance = app();
  storage.set('lifeos.assistant', JSON.stringify({ ...getAssistantSettings(), listenContinuously: false }));
  win.dispatchEvent(new Event('storage')); await flush();
  assert.deepEqual(instance.starts, []); assert.equal(isListening(), false);
});

test('master disable stops an active conversation and prevents automatic restart', async () => {
  consent(); const instance = app(); await flush();
  instance.lifecycle.begin('chat'); patch({ enabled: false });
  assert.equal(instance.mode, 'idle'); assert.equal(isListening(), false);
  instance.visibility(false); instance.visibility(true); await flush();
  assert.deepEqual(instance.starts, ['wake', 'chat']);
});

test('Settings enabling starts wake once, and unrelated edits never restart listening', async () => {
  const instance = app(); await flush();
  consent(); await flush();
  patch({ useAI: false }); patch({ wakeWord: 'hey helper' }); await flush();
  assert.deepEqual(instance.starts, ['wake']); assert.equal(nativeStarts, 1);
});

test('permission denial stops without clearing consent or retrying on foreground/events', async () => {
  consent(); const instance = app(); await flush();
  win.__lifeosSpeech.onSpeechError('permission_denied');
  assert.equal(instance.mode, 'idle'); assert.equal(isListening(), false);
  assert.match(instance.errors[0], /permission denied/);
  for (let i = 0; i < 3; i++) {
    instance.visibility(false); instance.visibility(true);
    patch({ useAI: i % 2 === 0 }); await flush();
  }
  patch({ listenContinuously: false }); consent(); await flush();
  assert.deepEqual(instance.starts, ['wake']);
  assert.equal(getAssistantSettings().wakeConsent, true);
  instance.lifecycle.begin('wake'); await flush();
  assert.deepEqual(instance.starts, ['wake', 'wake']);
});

test('synchronous native start failure is idle and has no automatic retry loop', async () => {
  win.LifeOSSpeech.startContinuous = () => { nativeStarts++; throw new Error('unavailable'); };
  consent(); const instance = app(); await flush();
  assert.equal(instance.mode, 'idle'); assert.equal(instance.errors.length, 1);
  instance.visibility(false); instance.visibility(true); await flush();
  assert.equal(nativeStarts, 1); assert.equal(isListening(), false);
});

test('unsupported speech never starts even with persisted consent', async () => {
  delete win.LifeOSSpeech;
  consent(); const instance = app(); await flush();
  instance.visibility(false); instance.visibility(true); await flush();
  assert.deepEqual(instance.starts, []); assert.equal(isListening(), false);
});
