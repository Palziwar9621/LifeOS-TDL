// LifeOS — a non-modal, hands-on first-login guide; never seeds or edits user data.
import React, { useEffect, useRef, useState } from 'react';
import { Logo } from '../ui/components';
import { currentUserId } from '../lib/db';
import { parseQuickAdd } from '../lib/quickadd';
import { isDemoMode, isGuestMode, useApp, type Page } from './store';
import { clearTutorialProgress, readTutorialProgress, saveTutorialProgress, type TutorialProgress } from './tutorialState';

export function resetTutorial(): void {
  const userId = currentUserId();
  if (userId) clearTutorialProgress(userId);
}

interface Step {
  title: string;
  body: string;
  tryIt: string;
  page: Page;
  action: string;
  tips: string[];
  practice?: boolean;
}

const STEPS: Step[] = [
  {
    title: 'Welcome — make LifeOS yours', page: 'home', action: 'Explore Home',
    body: 'Take a hands-on tour of your day, plans and knowledge. Explore opens the real screen and folds this guide away; Return to guide brings you back here.',
    tryIt: 'Look at Home’s overview and quick actions. An empty dashboard is a fresh start — there is no sample data to clean up.',
    tips: ['Go at your own pace: skip, jump to a topic, or restart anytime.', 'Progress measures tour topics, not tasks completed. Nothing is created just by taking this tour.'],
  },
  {
    title: 'Today — choose your next action', page: 'today', action: 'Explore Today',
    body: 'See today’s tasks, overdue work and your schedule together. Complete a real task using its circle only when you have actually done it.',
    tryIt: 'Find Today’s quick-add field. You can preview natural-language task text safely here before adding your own task in the app.',
    tips: ['Try “Read tomorrow at 7pm !high #learning” in the preview below.', 'This practice field only parses text. It never saves a task.'], practice: true,
  },
  {
    title: 'Tasks — organize the whole backlog', page: 'tasks', action: 'Explore Tasks',
    body: 'Switch between Inbox, Today, Upcoming, Overdue, Completed and All. Filters and sorting help narrow down a busy list.',
    tryIt: 'Try a view or filter. Open one of your tasks to inspect its dates, priority, tags, subtasks and project or goal links; cancel if you do not want to edit.',
    tips: ['Repeating tasks track each occurrence separately.', 'Use snooze/reschedule, duplicate and bulk actions on your own work when useful.'],
  },
  {
    title: 'Productivity — build a repeatable day', page: 'productivity', action: 'Explore Productivity',
    body: 'Routines are habits with selected weekdays and optional times. Day shows a checklist; Week shows consistency across the week.',
    tryIt: 'Switch between Day and Week, then select a date. Use Add to inspect the routine form and cancel, or save a real habit you want to track.',
    tips: ['A routine tick belongs to one date, not every future occurrence.', 'Choose an alarm sound in the routine editor if you want timed alerts.'],
  },
  {
    title: 'Calendar — see where your time goes', page: 'calendar', action: 'Explore Calendar',
    body: 'Day, week and month views bring dated tasks, reminders, schedule blocks and project milestones together.',
    tryIt: 'Switch the calendar view and select a date. If it is empty, use it to think about where your next real commitment belongs.',
    tips: ['Tasks are things to finish; schedule blocks reserve time.', 'Use Today to return after browsing other dates.'],
  },
  {
    title: 'Weekly plan — give work a time slot', page: 'weekly', action: 'Open weekly plan',
    body: 'The Plan tab in Productivity is a seven-day schedule of time blocks, with colors, recurrence and optional task links.',
    tryIt: 'Open the plan and inspect a time block or the add form. If you were already in Productivity, select Plan at the top.',
    tips: ['Plan is separate from the routine Week checklist.', 'Reserve time for classes, work, exercise or rest; save only a plan you actually want.'],
  },
  {
    title: 'Projects — turn a big idea into steps', page: 'projects', action: 'Explore Projects',
    body: 'Projects group related tasks with statuses, priority, dates, milestones and progress.',
    tryIt: 'Open a project you already have, or inspect the new-project form. Think of one milestone and the next task it needs.',
    tips: ['Link tasks to a project from the task editor.', 'Use On Hold or Archived when a project is not active.'],
  },
  {
    title: 'Goals — keep the bigger picture visible', page: 'goals', action: 'Explore Goals',
    body: 'Goals capture weekly, monthly, yearly or long-term outcomes, with deadlines, milestones and related tasks.',
    tryIt: 'Inspect a goal or its add form. Choose a measurable outcome you care about; you can cancel without saving.',
    tips: ['Projects organize the work; goals describe the outcome.', 'Connect relevant tasks so everyday actions support the goal.'],
  },
  {
    title: 'Library — notes, ideas and things to remember', page: 'library', action: 'Explore Library',
    body: 'Three tabs keep information close: Notes for writing, Ideas for someday/maybe, and Remember for principles, checklists and important dates.',
    tryIt: 'Visit each of the three Library tabs. Try searching your own items, or inspect an add form and cancel.',
    tips: ['Notes support folders, tags, pins, favorites and links to tasks, projects or goals.', 'Ideas can become projects; instant capture supports photos and voice notes with your permission.', 'Remember supports pinning, favorites and recurring birthday or renewal reminders.'],
  },
  {
    title: 'Reminders — put important moments on record', page: 'reminders', action: 'Explore Reminders',
    body: 'Standalone reminders have a time, an important flag, repeat rules and snooze options. Tasks and routines can also have alerts.',
    tryIt: 'Inspect a reminder form and its repeat options. Save only if it is a reminder you actually need.',
    tips: ['Settings → Notifications controls notification-only, alarm or off modes and sounds.', 'Delivery depends on notification permission, device settings and app support; check your setup before relying on an alert.'],
  },
  {
    title: 'Search & quick add — fewer clicks', page: 'search', action: 'Explore Search',
    body: 'Search across tasks, projects, goals, notes, ideas, Remember items, schedule blocks and reminders.',
    tryIt: 'Search for a word from one of your items. No items yet? Try the search field and come back once you have added something.',
    tips: ['Ctrl/⌘+F opens app search. Ctrl/⌘+K opens quick add — they are different shortcuts.', 'On mobile, Search and + are in the top bar; More opens the other sections.'],
  },
  {
    title: 'Focus — protect a little time', page: 'focus', action: 'Explore Focus',
    body: 'Use a Pomodoro or custom timer, optionally linked to a task, with pause/resume and session logging.',
    tryIt: 'Inspect the timer modes and task picker. Start only when you are ready for a real focus session.',
    tips: ['A timer is optional; you can keep using LifeOS without running one.', 'Your focus minutes contribute to Insights.'],
  },
  {
    title: 'Insights & review — learn, then adjust', page: 'stats', action: 'Explore Insights',
    body: 'Insights brings together completion trends, project progress, focus minutes and routine consistency. Its Review tab helps plan what comes next.',
    tryIt: 'Look at Stats, then switch to Review and compare daily and weekly views. Empty charts become useful as you use the app.',
    tips: ['Review unfinished work before rescheduling it.', 'These figures describe your recorded activity, not a score you need to maximize.'],
  },
  {
    title: 'Voice assistant — an optional shortcut', page: 'settings', action: 'Explore assistant settings',
    body: 'The microphone opens the assistant for spoken requests, such as checking today or adding a task. Availability depends on your browser and assistant configuration.',
    tryIt: 'Open Settings → Assistant to review its options. If you choose to enable it, try a read-only question such as “What is on today?”',
    tips: ['Speaking a create or change request can edit real data; check the result.', 'This tour does not turn on the microphone or request camera or notification access.'],
  },
  {
    title: 'Settings — keep your setup and data in hand', page: 'settings', action: 'Explore Settings',
    body: 'Personalize your profile and appearance, manage categories and tags, inspect sync, and use Backup & Export for JSON backups or task CSV files.',
    tryIt: 'Find Backup & Export, Notifications, and About. About → Show the tutorial again restarts this guide whenever you need it.',
    tips: ['Guest and demo data stay on this device. Signed-in accounts sync when connected; check pending changes and errors in sync status.', 'Tour progress is saved for this account on this device, separately from your tasks.', 'Finish closes the guide. You can keep exploring without creating anything.'],
  },
];

function QuickAddPractice() {
  const [text, setText] = useState('Read tomorrow at 7pm !high #learning');
  const parsed = parseQuickAdd(text);
  return <div className="space-y-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
    <label htmlFor="tour-practice" className="label">Try smart add — preview only</label>
    <input id="tour-practice" className="input" value={text} onChange={e => setText(e.target.value)} aria-describedby="tour-practice-preview" />
    <p id="tour-practice-preview" className="break-words text-xs leading-relaxed muted" aria-live="polite">
      {text.trim() ? `Title: ${parsed.title || '(add a title)'} · Due: ${parsed.due_date ?? 'none'} ${parsed.due_time ?? ''} · Priority: ${parsed.priority ?? 'default'} · Tags: ${parsed.tags.join(', ') || 'none'}` : 'Type a task to see what LifeOS detects. Nothing will be saved.'}
    </p>
  </div>;
}

export function Tutorial({ userId, initial, onDone }: { userId: string; initial: TutorialProgress | null; onDone: () => void }) {
  const { navigate } = useApp();
  const [idx, setIdx] = useState(initial?.step ?? 0);
  const [collapsed, setCollapsed] = useState(!!initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const step = STEPS[idx];

  useEffect(() => { saveTutorialProgress(userId, { status: 'active', step: idx }); }, [userId, idx]);
  useEffect(() => { if (!collapsed) heading.current?.focus(); }, [idx, collapsed]);

  const finish = (status: 'skipped' | 'completed') => {
    saveTutorialProgress(userId, { status, step: idx });
    onDone();
    document.getElementById('lifeos-page-content')?.focus();
  };
  const explore = () => {
    navigate(step.page);
    setCollapsed(true);
    requestAnimationFrame(() => document.getElementById('lifeos-page-content')?.focus());
  };

  return <section className="card mb-5 overflow-hidden border border-brand-500/30" aria-label="LifeOS getting started guide"
    onKeyDown={e => { if (e.key === 'Escape' && !collapsed) { e.stopPropagation(); setCollapsed(true); toggle.current?.focus(); } }}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 bg-brand-500/10 px-4 py-3">
      <Logo size={18} />
      <span className="flex-1 truncate text-xs font-semibold" aria-live="polite" title={step.title}>
        {collapsed ? step.title : `Your guide · Topic ${idx + 1} of ${STEPS.length}`}
      </span>
      <button ref={toggle} type="button" className="btn-secondary btn-sm shrink-0" aria-expanded={!collapsed} aria-controls={collapsed ? undefined : 'tour-details'} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? 'Return to guide' : 'Minimize'}
      </button>
      <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => finish('skipped')}>Skip tour</button>
    </div>
    {collapsed ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-xs muted">
      <progress className="h-1.5 w-16 shrink-0 accent-brand-500" value={idx + 1} max={STEPS.length} aria-label="Current tour topic" />
      <span className="min-w-0 flex-1 truncate" title={step.title}>{step.title}</span>
      <span className="shrink-0">{idx + 1}/{STEPS.length}</span>
    </div> :
      <div id="tour-details" className="space-y-3 p-4 sm:px-5">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 ref={heading} tabIndex={-1} className="text-lg font-extrabold leading-snug tracking-tight sm:shrink-0 sm:max-w-[60%]">{step.title}</h2>
          <div className="min-w-0 sm:w-56">
            <label htmlFor="tour-topic" className="sr-only">Jump to a tour topic</label>
            <select id="tour-topic" className="input !w-full text-sm sm:!w-auto" value={idx} onChange={e => setIdx(Number(e.target.value))}>
              {STEPS.map((s, i) => <option key={s.title} value={i}>{i + 1}. {s.title}</option>)}
            </select>
          </div>
        </div>
        <progress className="h-2 w-full accent-brand-500" value={idx + 1} max={STEPS.length} aria-label="Current tour topic" />
        <p className="text-sm leading-relaxed">{step.body}</p>
        <p className="rounded-xl bg-brand-500/10 p-3 text-sm leading-relaxed"><strong>Try it: </strong>{step.tryIt}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed muted">{step.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
        {step.practice && <QuickAddPractice />}
        {idx === 0 && <p className="text-xs muted">{isGuestMode() || isDemoMode() ? 'You are using local-only mode. Your data stays on this device.' : 'Your work is local-first and syncs to your account when connected.'}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className="btn-primary" onClick={explore}>{step.action}</button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setIdx(0); setCollapsed(false); }}>Restart</button>
            <button type="button" className="btn-secondary btn-sm" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Back</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => idx + 1 < STEPS.length ? setIdx(idx + 1) : finish('completed')}>
              {idx + 1 === STEPS.length ? 'Finish tour' : 'Next topic'}
            </button>
          </div>
        </div>
      </div>}
  </section>;
}

/** One owner handles first login, resuming and Settings restart — no duplicate tours. */
export function TutorialGate() {
  const { session } = useApp();
  const userId = session?.user.id;
  return userId ? <AccountTutorial key={userId} userId={userId} /> : null;
}

function AccountTutorial({ userId }: { userId: string }) {
  const [initial, setInitial] = useState(() => readTutorialProgress(userId, STEPS.length));
  const [show, setShow] = useState(!initial || initial.status === 'active');
  const [run, setRun] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const restart = () => {
      clearTutorialProgress(userId);
      setInitial(null);
      setRun(n => n + 1);
      setShow(true);
      requestAnimationFrame(() => container.current?.scrollIntoView({ block: 'start' }));
    };
    window.addEventListener('lifeos-show-tutorial', restart);
    return () => window.removeEventListener('lifeos-show-tutorial', restart);
  }, [userId]);
  return <div ref={container}>{show && <Tutorial key={run} userId={userId} initial={initial} onDone={() => setShow(false)} />}</div>;
}
