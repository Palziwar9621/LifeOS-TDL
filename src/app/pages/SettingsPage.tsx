// LifeOS — Settings
import React, { useEffect, useRef, useState } from 'react';
import { Icon, useConfirm } from '../../ui/components';
import { dbState, getSettings, updateSettings, createCategory, updateCategory, deleteCategory, createTag, deleteTag, updateProfile, getProfile, pull, createProject, createGoal, createNote, createIdea, createRememberItem, getLastSyncError, getUnsyncedCount, retryParked } from '../../lib/db';
import { useApp } from '../store';
import { todayStr } from '../../lib/dates';
import { exportAllJson, downloadJson, tasksCsv, parseBackupJson, readFileText } from '../../lib/backup';
import { requestNotificationPermission, notificationPermission } from '../../lib/notifications';
import { enablePush, disablePush, pushSupported, pushPermission, sendTestPush, pushEnvironment, nativeAlarmsActive } from '../../lib/push';
import { getAlertMode, setAlertMode, alertPermission, requestAlertPermission, type AlertMode } from '../../lib/alerts';
import { useI18n, LANGUAGES } from '../../lib/i18n';
import { nativeSyncStatus } from '../../lib/nativeAlarms';
import { AlarmSoundPicker } from '../AlarmSoundPicker';
import { updateUserPassword } from '../../lib/auth';
import { getClient, loadSupabaseConfig } from '../../lib/supabase';
import { createTask } from '../../lib/db';
import { getAssistantSettings, saveAssistantSettings, speechSupported, getVoicePerf } from '../../lib/voice';
import { deleteAccountRemote, purgeLocalData } from '../../lib/deleteAccount';
import { resetTutorial } from '../Tutorial';

type Section = 'account' | 'appearance' | 'notifications' | 'assistant' | 'categories' | 'tags' | 'sync' | 'data' | 'security' | 'about';

export function SettingsPage() {
  const { theme, setTheme, premiumTheme, setPremiumTheme, toast, signOut: appSignOut, syncNow, online, pendingOps } = useApp();
  const s = dbState();
  const profile = getProfile();
  const { confirm, confirmEl } = useConfirm();
  const [section, setSection] = useState<Section>('account');
  const [refreshing, setRefreshing] = useState(false);

  const sections: { key: Section; label: string; icon: string }[] = [
    { key: 'account', label: 'Account & Profile', icon: 'user' },
    { key: 'appearance', label: 'Appearance', icon: 'sun' },
    { key: 'notifications', label: 'Notifications', icon: 'bell' },
    { key: 'assistant', label: 'Voice Assistant', icon: 'mic' },
    { key: 'categories', label: 'Categories & Tags', icon: 'folder' },
    { key: 'sync', label: 'Data & Sync', icon: 'sync' },
    { key: 'data', label: 'Backup & Export', icon: 'note' },
    { key: 'security', label: 'Security', icon: 'settings' },
    { key: 'about', label: 'About', icon: 'info' },
  ];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight">Settings</h1>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <nav className="card h-fit p-2 max-md:flex max-md:gap-1 max-md:overflow-x-auto">
          {sections.map((sec) => (
            <button key={sec.key} className={`nav-item w-full whitespace-nowrap ${section === sec.key ? 'nav-item-active' : ''}`}
              onClick={() => setSection(sec.key)}>
              <Icon name={sec.icon} className="h-4 w-4" /> {sec.label}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          {section === 'account' && <AccountSection profile={profile} toast={toast} />}
          {section === 'appearance' && <AppearanceSection theme={theme} setTheme={setTheme} premiumTheme={premiumTheme} setPremiumTheme={setPremiumTheme} />}
          {section === 'notifications' && <NotificationsSection toast={toast} />}
          {section === 'assistant' && <AssistantSection toast={toast} />}
          {section === 'categories' && <CategoriesSection toast={toast} />}
          {section === 'sync' && <SyncSection toast={toast} />}
          {section === 'data' && <DataSection toast={toast} />}
          {section === 'security' && <SecuritySection onSignOut={appSignOut} />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>

      {/* Refresh — replaces the old pull-to-refresh gesture. Lives only in
          Settings, pinned to the bottom-left, always visible. */}
      <button
        className="mt-4 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        disabled={refreshing}
        onClick={async () => {
          setRefreshing(true);
          try { await syncNow(); await pull(); } finally { setRefreshing(false); }
        }}
        aria-label="Refresh data"
        title={online ? 'Refresh data (sync now)' : 'Offline — retry when connected'}
      >
        <Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        Refresh
        {pendingOps > 0 && (
          <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-bold text-amber-600 dark:text-amber-300">{pendingOps}</span>
        )}
      </button>

      {confirmEl}
    </div>
  );
}

// --------------------------------------------------
function AccountSection({ profile, toast }: any) {
  const [username, setUsername] = useState(profile?.username ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const s = dbState();
  const { session } = useApp();

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Account</h2>
      <div className="space-y-3">
        <div>
          <label className="label">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label">Profile picture URL</label>
          <input className="input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          <p className="mt-1 text-xs muted">Paste any image URL. (Uploads need Supabase Storage — easy to add later.)</p>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input opacity-60" value={session?.user?.email ?? ''} disabled />
        </div>
        <button className="btn-primary" onClick={() => { void updateProfile({ username, avatar_url: avatarUrl || null }); toast('Profile saved', 'success'); }}>
          Save profile
        </button>
      </div>
    </section>
  );
}

function AppearanceSection({ theme, setTheme, premiumTheme, setPremiumTheme }: any) {
  const { t, lang, setLang } = useI18n();
  const THEMES: { key: string; name: string; desc: string; bg: string; fg: string; accent: string; dark: boolean }[] = [
    { key: 'kage', name: 'Kage 影', desc: 'Ink black · vermilion · ambient glow', bg: '#0a0908', fg: '#efece4', accent: '#e0231c', dark: true },
    { key: 'noir', name: 'Obsidian & Champagne', desc: 'Velvet black · gold', bg: '#101013', fg: '#E9E9EC', accent: '#C9A96A', dark: true },
  ];

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">{t('settings.appearance')}</h2>

      <p className="label">{t('settings.language')}</p>
      <select
        className="input mb-1"
        value={lang}
        onChange={(e) => setLang(e.target.value as any)}
        aria-label={t('settings.language')}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label} · {l.english}</option>
        ))}
      </select>
      <p className="text-xs muted mb-2">App interface language. Content you wrote stays as-is.</p>

      <p className="label mt-4">{t('settings.mode')}</p>
      <div className="grid grid-cols-3 gap-2">
        {(['light', 'dark', 'system'] as const).map((m) => (
          <button key={m} className={`rounded-2xl p-4 text-sm font-semibold ring-1 transition ${theme === m ? 'ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'ring-slate-900/10 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            onClick={() => setTheme(m)}>
            <span className="mb-1 block text-xl">{m === 'light' ? '☀️' : m === 'dark' ? '🌙' : '💻'}</span>
            {m === 'light' ? t('settings.modeLight') : m === 'dark' ? t('settings.modeDark') : t('settings.modeSystem')}
          </button>
        ))}
      </div>

      <p className="label mt-5">{t('settings.premiumTheme')}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          className={`rounded-2xl p-4 text-left ring-1 transition ${premiumTheme == null ? 'ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'ring-slate-900/10 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          onClick={() => setPremiumTheme(null)}>
          <span className="mb-2 flex gap-1">
            {['#F1F5F9', '#334155', '#6366F1'].map((c) => <span key={c} className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: c }} />)}
          </span>
          <span className="block text-sm font-semibold">Default</span>
          <span className="text-xs muted">Classic LifeOS look</span>
        </button>
        {THEMES.map((t) => (
          <button
            key={t.key}
            className={`rounded-2xl p-4 text-left ring-1 transition ${premiumTheme === t.key ? 'ring-2 ring-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'ring-slate-900/10 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            onClick={() => setPremiumTheme(t.key)}>
            <span className="mb-2 flex gap-1">
              <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: t.bg }} />
              <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: t.fg }} />
              <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: t.accent }} />
            </span>
            <span className="block text-sm font-semibold">{t.name}</span>
            <span className="text-xs muted">{t.desc}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs muted">Kage pairs beautifully with Mode set to Dark — ink surfaces, a breathing vermilion glow and drifting embers. Your choice is remembered on this device.</p>
    </section>
  );
}

function AssistantSection({ toast }: any) {
  const [s, setS] = useState(() => getAssistantSettings());
  const supported = speechSupported();
  const isAndroid = typeof navigator !== 'undefined' && /LifeOSNative/.test(navigator.userAgent);
  const nativeAssistant = isAndroid ? (window as any).LifeOSAssistant ?? null : null;
  const [wakeOn, setWakeOn] = useState<boolean>(() => !!nativeAssistant?.wakeEnabled?.());

  useEffect(() => {
    const changed = () => setS(getAssistantSettings());
    window.addEventListener('lifeos-assistant-settings', changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('lifeos-assistant-settings', changed);
      window.removeEventListener('storage', changed);
    };
  }, []);

  const patch = (p: Partial<typeof s>) => {
    const next = { ...getAssistantSettings(), ...p };
    setS(next);
    saveAssistantSettings(next);
  };

  const toggleWake = (on: boolean) => {
    if (!nativeAssistant) return;
    if (on) nativeAssistant.requestMicPermission?.();
    const res = nativeAssistant.setWakeEnabled?.(on, s.wakeWord);
    setWakeOn(on);
    if (res && String(res).includes('false')) toast('Could not start background listener', 'error');
    else toast(on ? 'Background listening on — say the wake word anytime' : 'Background listening off', 'success');
  };

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Voice Assistant</h2>
      {!supported ? (
        <p className="text-sm muted">This browser/webview doesn't support speech recognition. The assistant works in Chrome, Edge, and the Android app on most devices.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={() => {
              const n = (window as any).LifeOSSpeech;
              if (n && typeof n.speak === 'function') {
                // Native bridge (Android app): route through the same path the assistant uses.
                (window as any).__lifeosSpeech = (window as any).__lifeosSpeech || {};
                (window as any).__lifeosSpeech.onSpeakEnd = (st: string) => {
                  if (st === 'unavailable') toast('Speech engine missing on this device — replies can\'t be spoken.', 'error');
                  else toast('Speech engine works ✓', 'success');
                };
                n.speak('Voice test. If you can hear this, spoken replies are working.');
              } else if (typeof speechSynthesis !== 'undefined') {
                const u = new SpeechSynthesisUtterance('Voice test. If you can hear this, spoken replies are working.');
                u.onend = () => toast('Speech engine works ✓', 'success');
                u.onerror = () => toast('Speech synthesis failed in this browser', 'error');
                speechSynthesis.speak(u);
              } else {
                toast('No speech engine available', 'error');
              }
            }}>🔊 Test voice output</button>
          </div>

          <label className="mb-4 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Voice assistant enabled</span>
            <input type="checkbox" className="checkbox-tap" checked={s.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          </label>

          <label className="mb-4 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Wake mode while app is open</span>
            <input type="checkbox" className="checkbox-tap" checked={s.wakeConsent === true && s.listenContinuously} disabled={!s.enabled}
              onChange={(e) => patch({ listenContinuously: e.target.checked, wakeConsent: e.target.checked })} />
          </label>
          <p className="text-xs muted -mt-2 mb-4">Remembered on this device. When enabled, LifeOS waits for your wake word when opened or brought back to the foreground; it does not resume a conversation. Tapping the mic to stop pauses this session until the next app launch or resume. Turn this option off to stop foreground wake listening permanently. Microphone permission is required; after an error, tap Resume wake mode to retry.</p>

          <label className="mb-4 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">AI understanding (Groq)</span>
            <input type="checkbox" className="checkbox-tap" checked={s.useAI} onChange={(e) => patch({ useAI: e.target.checked })} />
          </label>
          <p className="text-xs muted -mt-2 mb-4">On: free-form speech (“tomorrow I have dinner at 9 PM” → timed task with alarm). Off: built-in offline parser only. Your speech text is sent to the AI service only when this is on.</p>

          <label className="label">Wake word</label>
          <input className="input mb-1" value={s.wakeWord} onChange={(e) => patch({ wakeWord: e.target.value.toLowerCase() })} placeholder="hey lifeos" />
          <p className="text-xs muted mb-4">While wake mode is waiting, say your complete wake phrase to start a voice chat, then keep giving commands without repeating it. The chat stays on until you say “turn off assistant” or tap the mic. Automatic foreground listening requires the wake mode option above.</p>

          {nativeAssistant && (
            <div className="rounded-2xl ring-1 ring-slate-900/10 dark:ring-white/10 p-4 mb-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Listen when app is closed</span>
                <input type="checkbox" className="checkbox-tap" checked={wakeOn} onChange={(e) => toggleWake(e.target.checked)} />
              </label>
              <p className="text-xs muted mt-1.5">Runs a background listener so “{s.wakeWord}” works anytime — Android shows a mic icon while it's active. When the wake word is heard you get a tap-to-speak popup; saying “{s.wakeWord} open the app” opens LifeOS.</p>
            </div>
          )}

          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 text-xs muted">
            <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">What you can say</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>“Tomorrow I have dinner at 9 PM” → timed task, alarm on</li>
              <li>“Remind me about the dentist Friday” / “Don't remind me about dinner”</li>
              <li>“Mark laundry as done” / “Delete the milk task”</li>
              <li>“Open calendar” / “What's on my day?”</li>
            </ul>
          </div>

          <VoicePerf />
        </>
      )}
    </section>
  );
}

// Voice-pipeline stage timings (stage names + ms only; never transcripts).
// Makes device-side stalls visible without any developer tools.
function VoicePerf() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 2000);
    return () => clearInterval(t);
  }, []);
  const entries = getVoicePerf().slice(-6);
  if (!entries.length) return null;
  return (
    <div className="mt-4 text-xs muted">
      <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">Recent voice timings</p>
      <ul className="space-y-0.5">
        {entries.map((e, i) => (
          <li key={i}>
            {e.stage}{e.ms != null ? `: +${e.ms} ms` : ''} <span className="opacity-60">({Math.round(e.ago / 1000)}s ago)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotificationsSection({ toast }: any) {
  const settings = getSettings();
  const [enabled, setEnabled] = useState(settings.notifications_enabled !== false);
  // settings IS the data object (getSettings() unwraps user_settings.data).
  const [alarmSound, setAlarmSound] = useState<string | null>((settings as any)?.alarm_sound ?? 'chime');
  const [mode, setMode] = useState<AlertMode>(getAlertMode());
  const perm = notificationPermission();

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Notifications</h2>
      <p className="text-sm font-semibold">When a routine or task time arrives</p>
      <p className="mb-2 text-xs muted">Applies to everything on the Productivity tab (routines), tasks with alerts, and reminders. Works even when the app is closed.</p>
      <div className="flex flex-wrap gap-2">
        {([['notify', '🔔 Notification only'], ['alarm', '⏰ Notification + alarm'], ['off', '🔇 Off']] as const).map(([v, label]) => (
          <button
            key={v}
            className={mode === v ? 'btn-primary !py-1.5 text-xs' : 'btn-secondary !py-1.5 text-xs'}
            onClick={async () => {
              setMode(v);
              await setAlertMode(v);
              if (v !== 'off' && alertPermission() !== 'granted') {
                const p = await requestAlertPermission();
                if (p !== 'granted') toast('Please allow notifications so alerts can reach you.', 'info');
              }
              toast(v === 'off' ? 'Alerts off' : v === 'alarm' ? 'Full alarm on — rings until you turn it off' : 'Notification only — no ringing', 'success');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="divider my-3" />
      <label className="flex items-center justify-between gap-3 py-2">
        <span>
          <span className="text-sm font-semibold">Reminder notifications</span>
          <span className="block text-xs muted">Pop up while the app is open (any tab of this browser).</span>
        </span>
        <input type="checkbox" className="checkbox-tap" checked={enabled}
          onChange={async (e) => {
            setEnabled(e.target.checked);
            await updateSettings({ notifications_enabled: e.target.checked });
            if (e.target.checked && perm !== 'granted') {
              const p = await requestNotificationPermission();
              if (p !== 'granted') toast('Please allow notifications in the browser prompt.', 'info');
            }
          }} />
      </label>
      <div className="divider my-3" />
      <p className="text-sm font-semibold">Default alarm sound</p>
      <p className="mb-2 text-xs muted">Rings when any reminder, task or routine fires — until you dismiss it (max 3 min). Click a sound to hear it.</p>
      <AlarmSoundPicker value={alarmSound} onChange={(v) => { setAlarmSound(v); void updateSettings({ alarm_sound: v }); }} />
      <div className="divider my-3" />
      <p className="text-xs muted">
        Permission: <b>{perm === 'granted' ? 'granted ✓' : perm === 'denied' ? 'blocked ✕ (enable in browser site settings)' : 'not asked yet'}</b>
      </p>
      <div className="divider my-3" />
      <PushAlarmsCard toast={toast} />
    </section>
  );
}

/** Android shell: show the real exact-alarm permission state with a one-tap
 * fix — opens the system "Alarms & reminders" grant screen when missing. */
function ExactAlarmCard() {
  const native = (window as any).LifeOSNative;
  const supported = !!native?.canScheduleExact;
  const [granted, setGranted] = useState<boolean | null>(
    supported ? !!native.canScheduleExact() : null,
  );
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && supported) setGranted(!!native.canScheduleExact());
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [supported]);
  if (!supported) return null;
  if (granted) {
    return (
      <p className="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        ✓ Exact alarms granted — this app is listed in Android's "Alarms & reminders" for LifeOS.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-amber-400/50 bg-amber-50 p-3 dark:bg-amber-950/30">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
        Exact alarm permission missing — alarms may not ring with the app closed.
      </p>
      <button
        className="btn-primary mt-2 !py-1.5 text-xs"
        onClick={() => native.openExactAlarmSettings()}
      >
        Grant exact alarm permission
      </button>
      <p className="mt-1 text-[11px] muted">Toggles "Alarms &amp; reminders" on for LifeOS — come back and this turns green.</p>
    </div>
  );
}

function PushAlarmsCard({ toast }: any) {
  const supported = pushSupported();
  const env = pushEnvironment();
  const [perm, setPerm] = useState(pushPermission());
  const [busy, setBusy] = useState(false);

  // The installed apps (Android shell / Electron) have no push service —
  // but native alarms cover closed-app ringing there instead. Be honest.
  if (env !== 'browser') {
    return (
      <div>
        <p className="text-sm font-semibold">Alarms with the app closed</p>
        {env === 'android-shell' && <ExactAlarmCard />}
        <p className="mt-2 text-xs muted">
          {env === 'android-shell'
            ? '✓ This app schedules alarms natively (Android AlarmManager) — reminders, task alerts and routines ring with full sound + vibration even when the app is closed or the phone restarted. No web-push setup needed here. (Web push is only for browsers.)'
            : '✓ This app schedules alarms natively — reminders, task alerts and routines ring with a system notification + sound even when the window is closed to the tray. Keep the app running in the tray (not quit) for alarms to fire. No web-push setup needed here.'}
        </p>
        {!nativeAlarmsActive() && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            Native alarms not connected yet — fully close and reopen the app once, then check again.
          </p>
        )}
        {nativeAlarmsActive() && (
          <p className="mt-1 text-[11px] muted break-all">
            Bridge status: {nativeSyncStatus() ?? 'not synced yet (first sync runs a few seconds after load)'}
          </p>
        )}
      </div>
    );
  }

  const enable = async () => {
    setBusy(true);
    const res = await enablePush();
    setPerm(pushPermission());
    setBusy(false);
    if (res.ok) toast('Push alarms enabled on this device 🔔', 'success');
    else toast(res.error ?? 'Could not enable push', 'error');
  };

  if (!supported) {
    return (
      <p className="text-xs muted">
        Background alarms need web push, which this browser doesn't support. In-app alarms still work while LifeOS is open.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm font-semibold">Alarms with the app closed</p>
      <p className="mb-2 text-xs muted">
        Subscribe this device so reminders, task alerts and routines ring even when LifeOS and the browser are closed.
        You'll get a full-screen notification with vibration; the system notification sound plays (a LifeOS tone plays too once you tap it and the app opens).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || perm === 'denied'} onClick={() => void enable()}>
          <Icon name="bell" className="h-4 w-4" />
          {perm === 'granted' ? 'Re-subscribe this device' : 'Enable background alarms'}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await sendTestPush();
          setBusy(false);
          if (r.ok) toast('Test push sent — check your notifications', 'success');
          else toast(r.error ?? 'Test failed', 'error');
        }}>
          Send test alarm
        </button>
        {perm === 'granted' && (
          <button className="btn-ghost btn-sm text-rose-500" disabled={busy} onClick={async () => {
            setBusy(true); await disablePush(); setPerm(pushPermission()); setBusy(false);
            toast('This device unsubscribed from background alarms');
          }}>Unsubscribe</button>
        )}
      </div>
      {perm === 'denied' && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
          Notifications are blocked for this site. Open the lock icon in the address bar → Notifications → Allow, then re-subscribe.
        </p>
      )}
    </div>
  );
}

function CategoriesSection({ toast }: any) {
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const [newCat, setNewCat] = useState('');
  const [newTag, setNewTag] = useState('');

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="section-title mb-4">Categories</h2>
        <div className="space-y-2">
          {s.categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <input type="color" className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent p-0" value={c.color}
                onChange={(e) => void updateCategory(c.id, { color: e.target.value })} aria-label={`Color for ${c.name}`} />
              <input className="input flex-1 !py-1.5" value={c.name}
                onChange={(e) => void updateCategory(c.id, { name: e.target.value })} aria-label={`Rename ${c.name}`} />
              <button className="btn-ghost btn-sm text-rose-500" aria-label={`Delete ${c.name}`}
                onClick={() => confirm('Delete category?', `“${c.name}” will be removed from tasks using it.`, () => void deleteCategory(c.id))}>
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input flex-1" placeholder="New category…" value={newCat} onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newCat.trim()) { void createCategory(newCat); setNewCat(''); } }} />
          <button className="btn-secondary" onClick={() => { if (newCat.trim()) { void createCategory(newCat); setNewCat(''); } }}>Add</button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-4">Tags</h2>
        <div className="flex flex-wrap gap-2">
          {s.tags.map((t) => (
            <span key={t.id} className="chip chip-brand">
              #{t.name}
              <button className="ml-1 text-rose-500" aria-label={`Delete tag ${t.name}`} onClick={() => void deleteTag(t.id)}><Icon name="x" className="h-3 w-3" /></button>
            </span>
          ))}
          {s.tags.length === 0 && <p className="text-sm muted">No tags yet — tags are created when you add them to a task.</p>}
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input flex-1" placeholder="Create a tag…" value={newTag} onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newTag.trim()) { void createTag(newTag); setNewTag(''); } }} />
          <button className="btn-secondary" onClick={() => { if (newTag.trim()) { void createTag(newTag); setNewTag(''); } }}>Add</button>
        </div>
      </section>
      {confirmEl}
    </div>
  );
}

function SyncSection({ toast }: any) {
  const { online, pendingOps, syncNow } = useApp();
  const [busy, setBusy] = useState(false);
  const cfg = loadSupabaseConfig();

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Data & Synchronization</h2>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-3">
          <span>Status</span>
          <b className={online ? 'text-emerald-600' : 'text-amber-600'}>{online ? 'Online' : 'Offline'}</b>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-3">
          <span>Pending changes</span>
          <b className={getUnsyncedCount() > pendingOps ? 'text-amber-600' : undefined}>{pendingOps}</b>
        </div>
        {getUnsyncedCount() > pendingOps && (
          <div className="rounded-xl bg-amber-500/10 px-4 py-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-300">
              {getUnsyncedCount() - pendingOps} change{getUnsyncedCount() - pendingOps === 1 ? '' : 's'} parked after repeated failures
            </p>
            <p className="mt-0.5 text-xs text-amber-600/90 dark:text-amber-300/90">
              These were never uploaded to the server. Fix the error below, then tap Retry parked changes.
            </p>
            <button className="btn-primary mt-2 w-full" disabled={busy || !online}
              onClick={async () => { setBusy(true); await retryParked(); await syncNow(); setBusy(false); }}>
              <Icon name="sync" className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Retry parked changes
            </button>
          </div>
        )}
        {getLastSyncError() && (
          <div className="rounded-xl bg-rose-500/10 px-4 py-3">
            <p className="text-xs font-bold text-rose-600 dark:text-rose-300">Last sync error</p>
            <p className="mt-0.5 break-words text-xs text-rose-600/90 dark:text-rose-300/90">{getLastSyncError()}</p>
            {/column|relation|does not exist|schema/i.test(getLastSyncError() ?? '') && (
              <p className="mt-1.5 text-xs text-rose-600/80 dark:text-rose-300/80">
                This usually means a database migration hasn't run yet. Check the project README / migrations folder in the repo and run the latest migration in Supabase → SQL Editor.
              </p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-3">
          <span>Backend</span>
          <b className="truncate">{cfg?.url ? new URL(cfg.url).hostname : 'not configured'}</b>
        </div>
        <button className="btn-primary w-full" disabled={busy || !online}
          onClick={async () => { setBusy(true); await syncNow(); setBusy(false); }}>
          <Icon name="sync" className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Sync now
        </button>
        <p className="text-xs muted">
          Everything is stored locally first and synced automatically. Conflicts resolve by newest change, and pending local edits are never overwritten by the server.
        </p>
      </div>
    </section>
  );
}

function DataSection({ toast }: any) {
  const fileRef = useRef<HTMLInputElement>(null);
  const s = dbState();
  const sb = getClient();
  const { confirm, confirmEl } = useConfirm();

  const doExport = () => {
    const json = exportAllJson();
    downloadJson(`lifeos-backup-${todayStr()}.json`, json);
    toast('Backup downloaded', 'success');
  };

  const doExportCsv = () => {
    const csv = tasksCsv(s.tasks);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lifeos-tasks-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Tasks CSV downloaded', 'success');
  };

  const doImport = async (file: File) => {
    try {
      const text = await readFileText(file);
      const parsed = parseBackupJson(text);
      if (!parsed) { toast('Not a valid LifeOS backup file', 'error'); return; }        confirm('Import backup?', 'Rows from the backup will be merged in (newest wins per item). Your current data stays.', async () => {
          const count = await importBackup(parsed.data);
          toast(`Imported ${count} rows`, 'success');
          await pull();
        }, { confirmLabel: 'Import' });
    } catch {
      toast('Could not read that file', 'error');
    }
  };

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Backup & Export</h2>
      <div className="space-y-2">
        <button className="btn-secondary w-full justify-start" onClick={doExport}>
          <Icon name="note" className="h-4 w-4" /> Export everything (JSON)
        </button>
        <button className="btn-secondary w-full justify-start" onClick={doExportCsv}>
          <Icon name="list" className="h-4 w-4" /> Export tasks (CSV)
        </button>
        <button className="btn-secondary w-full justify-start" onClick={() => fileRef.current?.click()}>
          <Icon name="sync" className="h-4 w-4" /> Import JSON backup…
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
      </div>
      <p className="mt-3 text-xs muted">Your data belongs to you — export anytime, in standard formats.</p>
      {confirmEl}
    </section>
  );
}

function SecuritySection({ onSignOut }: any) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { toast } = useApp();
  const { confirm, confirmEl } = useConfirm();
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { session, signOut } = useApp();

  const deleteConfirmed = deleteText.trim().toUpperCase() === 'DELETE';

  const runDeletion = async () => {
    setDeleting(true);
    const uid = session?.user?.id;
    const r = await deleteAccountRemote();
    if (!r.ok) {
      setDeleting(false);
      toast(r.error ?? 'Account deletion failed — nothing was deleted. Try again.', 'error');
      return;
    }
    // Server confirmed. Now clear every local trace (cache, outbox, settings).
    if (uid) await purgeLocalData(uid);
    try {
      const sb = getClient();
      if (sb) await sb.auth.signOut();
    } catch { /* session already revoked server-side */ }
    setDeleting(false);
    toast('Your account and its data have been deleted.', 'success');
    // Reload to a clean state (no cached data, no session).
    setTimeout(() => window.location.replace('/'), 1200);
  };

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Security</h2>
      <div className="space-y-3">
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={async () => {
          if (pw.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
          if (pw !== pw2) { toast('Passwords don\'t match', 'error'); return; }
          const r = await updateUserPassword(pw);
          if (r.ok) { toast('Password updated', 'success'); setPw(''); setPw2(''); }
          else toast(r.error ?? 'Could not update password', 'error');
        }}>Change password</button>
        <div className="divider my-3" />
        <button className="btn-danger" onClick={() => confirm('Sign out?', 'You can sign back in anytime — data is safe on the server.', () => void onSignOut(), { confirmLabel: 'Sign out', danger: false })}>
          <Icon name="logout" className="h-4 w-4" /> Sign out
        </button>

        <div className="divider my-3" />
        <div className="rounded-2xl ring-1 ring-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm font-bold text-rose-600 dark:text-rose-300">Delete account</p>
          <p className="mt-1 text-xs muted">
            Permanently deletes your account, and all your tasks, notes, ideas, reminders,
            routines, goals, projects, focus history and settings from the server — and clears
            this device's local cache. <b>This cannot be undone.</b> Export your data first
            (Backup &amp; Export) if you might want it later.
          </p>
          <label className="label mt-3">Type DELETE to confirm</label>
          <input
            className="input"
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm account deletion"
            autoComplete="off"
          />
          <button
            className="btn-danger mt-3"
            disabled={!deleteConfirmed || deleting}
            onClick={() => confirm(
              'Delete your account permanently?',
              'Everything you created in LifeOS will be erased from the server and this device. This cannot be undone.',
              () => void runDeletion(),
              { confirmLabel: 'Delete forever' },
            )}
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
          {deleting && <p className="mt-2 text-xs muted">Deleting server data — keep this page open until you see the confirmation.</p>}
        </div>
      </div>
      {confirmEl}
    </section>
  );
}

function AboutSection() {
  return (
    <section className="card p-5">
      <h2 className="section-title mb-2">About LifeOS</h2>
      <p className="text-sm muted">
        LifeOS is your personal productivity system: tasks, projects, goals, notes, ideas, weekly planning, calendar, reminders, focus sessions and gentle statistics — local-first and synced end-to-end via Supabase.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="btn-primary btn-sm" href="/download.html" target="_blank" rel="noreferrer">
          📲 Get the app
        </a>
        <button
          className="btn-secondary btn-sm"
          onClick={() => { resetTutorial(); window.dispatchEvent(new CustomEvent('lifeos-show-tutorial')); }}
        >
          🎓 Show the tutorial again
        </button>
        <span className="text-xs muted">Windows app · Android app</span>
      </div>
      <p className="mt-2 text-xs muted">Version 1.0.0 · Built with React, Vite, Tailwind CSS & Supabase</p>
    </section>
  );
}

async function importBackup(data: Record<string, any[]>): Promise<number> {
  let count = 0;
  const { createTask } = await import('../../lib/db');
  const tables = ['categories', 'tags', 'projects', 'goals', 'notes', 'ideas', 'remember_items'];
  // straightforward merge: insert rows that don't exist locally yet
  for (const t of tables) {
    const rows = data[t] ?? [];
    for (const row of rows) {
      if (t === 'categories') await createCategory(row.name, row.color);
      else if (t === 'tags') await createTag(row.name, row.color);
      else if (t === 'projects') await createProject(row);
      else if (t === 'goals') await createGoal(row);
      else if (t === 'notes') await createNote(row);
      else if (t === 'ideas') await createIdea(row);
      else if (t === 'remember_items') await createRememberItem(row);
      count++;
    }
  }
  // tasks with subtasks
  for (const t of data.tasks ?? []) {
    await createTask({ ...t, subtaskTitles: (data.subtasks ?? []).filter((x: any) => x.task_id === t.id).map((x: any) => x.title) });
    count++;
  }
  return count;
}


