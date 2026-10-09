// LifeOS — first-run tutorial.
// Comprehensive walkthrough of every major feature, shown once for new users
// (guest or signed-in). "Skip all" is always available, plus per-step Skip.
// Restartable from Settings → About ("Show tutorial again").
import React, { useEffect, useState, useCallback } from 'react';
import { Icon, Logo } from '../ui/components';
import { useApp, type Page } from './store';

const KEY = 'lifeos.tutorial.done';

export function tutorialDone(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function markTutorialDone(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
}
export function resetTutorial(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

interface Step {
  title: string;
  body: string;
  page?: Page;          // navigate there when the step is shown
  bullet?: string[];    // sub-points
}

const STEPS: Step[] = [
  {
    title: 'Welcome to LifeOS 👋',
    body: 'One place for your tasks, routines, notes, projects and goals — plus a voice assistant that can do almost everything for you.',
  },
  {
    title: 'Home — your day at a glance',
    body: 'Greeting, today\'s snapshot, quick stats and shortcuts.',
    page: 'home',
  },
  {
    title: 'Today & Tasks',
    body: 'Today lists what\'s due today; Tasks is the full backlog with filters, priorities and drag-reorder.',
    page: 'today',
    bullet: [
      'Tap the circle to complete, long-press rows for actions',
      'Quick add (＋ button) parses "gym tomorrow 6pm high priority"',
    ],
  },
  {
    title: 'Productivity — routines',
    body: 'Repeating habits live here: "Gym" every Mon/Wed/Fri, "Read" daily. Tick each day; alarms fire at each routine\'s time.',
    page: 'productivity',
    bullet: ['Add with the + button or just tell the assistant: "add a routine: gym every mon wed fri"'],
  },
  {
    title: 'Calendar & Weekly plan',
    body: 'Calendar shows tasks and reminders by date; the weekly view inside Productivity lets you block out time.',
    page: 'calendar',
  },
  {
    title: 'Projects & Goals',
    body: 'Group related tasks under Projects (with milestones), and track long-term Goals with progress.',
    page: 'projects',
  },
  {
    title: 'Library — notes, ideas, remember',
    body: 'Notes for information, Ideas for someday-maybe, Remember for facts you keep forgetting (PINs, birthdays).',
    page: 'library',
  },
  {
    title: 'Reminders & alarms',
    body: 'Standalone reminders ring at their time; tasks with alarms ring too. Alarms keep ringing until you turn them off — no missed dose.',
    page: 'reminders',
    bullet: ['Pick the alarm sound in Settings → Notifications; set mode to Notification only / Notification + alarm / Off'],
  },
  {
    title: 'Voice assistant 🎙️',
    body: 'The mic button (bottom-right) starts a conversation — no exact phrasing needed. Say the wake word ("hey lifeos") or tap the mic, then just talk.',
    page: 'settings',
    bullet: [
      '"add a task: dinner reservation tomorrow 7pm"',
      '"move my dentist to friday", "what\'s on today", "complete gym"',
      'Interrupt anytime — just talk over the assistant and it stops to listen',
    ],
  },
  {
    title: 'Search & focus',
    body: 'Search (or Ctrl+K) finds anything; Focus runs pomodoro-style sessions; Stats/Review help you look back.',
    page: 'search',
  },
  {
    title: 'You\'re all set ✨',
    body: 'Everything syncs when you\'re online; the green/red sync badge at the bottom-left shows status. Ask the assistant anything — it\'s the fastest way in.',
    bullet: ['Tip: you can re-watch this tour anytime in Settings → About'],
  },
];

export function Tutorial({ onDone }: { onDone?: () => void }) {
  const { navigate } = useApp();
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(true);
  const step = STEPS[idx];

  useEffect(() => {
    if (step?.page && shown) navigate(step.page);
  }, [idx, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => { markTutorialDone(); setShown(false); onDone?.(); }, [onDone]);
  const next = () => (idx + 1 < STEPS.length ? setIdx(idx + 1) : finish());

  if (!shown) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/60 backdrop-blur-sm md:items-center" role="dialog" aria-label="Tutorial">
      <div className="card w-full max-w-lg m-4 p-0 overflow-hidden animate-slide-up">
        <div className="flex items-center gap-3 border-b border-slate-900/5 dark:border-white/10 bg-gradient-to-r from-brand-500/10 to-violet-500/10 px-5 py-4">
          <Logo size={22} />
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" onClick={finish} aria-label="Skip tutorial">
            Skip all
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-extrabold tracking-tight">{step.title}</h2>
            <span className="text-xs muted">{idx + 1} / {STEPS.length}</span>
          </div>
          <p className="mt-3 text-sm">{step.body}</p>
          {step.bullet && (
            <ul className="mt-3 space-y-1.5">
              {step.bullet.map((b) => (
                <li key={b} className="flex gap-2 text-xs muted">
                  <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-brand-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700'}`} />
              ))}
            </div>
            <div className="flex gap-2">
              {idx > 0 && <button className="btn-ghost btn-sm" onClick={() => setIdx(idx - 1)}>Back</button>}
              <button className="btn-primary btn-sm" onClick={next}>
                {idx + 1 === STEPS.length ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mounts the tutorial once per install. */
export function TutorialGate() {
  const [show, setShow] = useState<boolean>(false);
  useEffect(() => {
    // Defer to after store init/auth — App renders this inside Shell.
    if (!tutorialDone()) setShow(true);
  }, []);
  if (!show) return null;
  return <Tutorial />;
}
