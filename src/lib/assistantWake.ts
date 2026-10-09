import type { AssistantSettings } from './voice';

type WakeSettings = Pick<AssistantSettings, 'enabled' | 'wakeConsent' | 'listenContinuously'>;
type SessionMode = 'chat' | 'wake';

export function foregroundWakeEnabled(settings: WakeSettings): boolean {
  return settings.enabled && settings.wakeConsent === true && settings.listenContinuously === true;
}

/** Foreground session policy. Persisted consent is read, never written by a resume.
 * A failed microphone needs an explicit retry; a manual stop lasts until resume.
 * The deferred mount is cancellable so StrictMode's setup/cleanup/setup starts once.
 */
export function createAssistantWakeLifecycle(port: {
  settings: () => WakeSettings;
  visible: () => boolean;
  supported: () => boolean;
  start: (mode: SessionMode) => boolean;
  stop: () => void;
}) {
  let mounted = false;
  let visible = false;
  let enabled = false;
  let active = false;
  let paused = false;
  let failed = false;
  let generation = 0;

  const stop = () => {
    generation++;
    active = false;
    port.stop();
  };
  const fail = () => {
    if (!mounted || !active) return;
    failed = true;
    stop();
  };
  const start = (mode: SessionMode) => {
    generation++;
    if (!mounted || !port.visible() || !port.supported() || !port.settings().enabled) return;
    if (mode === 'wake' && !foregroundWakeEnabled(port.settings())) return;
    active = true;
    if (!port.start(mode)) fail();
  };
  const resume = () => {
    const token = ++generation;
    queueMicrotask(() => {
      if (token !== generation || !mounted || active || paused || failed) return;
      if (foregroundWakeEnabled(port.settings())) start('wake');
    });
  };

  return {
    mount() {
      mounted = true;
      visible = port.visible();
      enabled = foregroundWakeEnabled(port.settings());
      if (visible && enabled) resume();
    },
    unmount() {
      mounted = false;
      stop();
    },
    settingsChanged() {
      const settings = port.settings();
      const next = foregroundWakeEnabled(settings);
      const previous = enabled;
      enabled = next;
      // Also stop a conversation entered through the wake listener on opt-out.
      if (!settings.enabled || (previous && !next)) stop();
      else if (!previous && next) {
        paused = false;
        if (port.visible()) resume();
      }
    },
    visibilityChanged() {
      const next = port.visible();
      if (next === visible) return;
      visible = next;
      if (!next) stop();
      else {
        paused = false;
        resume();
      }
    },
    begin(mode: SessionMode) {
      paused = false;
      failed = false;
      start(mode);
    },
    stop() {
      paused = true;
      stop();
    },
    fail,
  };
}
