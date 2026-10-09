# LifeOS — Complete App Description & Master Fix Prompt

## What LifeOS is

**LifeOS** is a personal productivity app that runs everywhere — as a website (life-os-tdl.vercel.app), an installed Android app (standalone APK with native alarms and background voice listening), and a Windows desktop app (installer + portable) — all sharing **one account and one real-time Supabase (Postgres) database**. It is **offline-first**: every action works without internet, is queued in a local outbox, and syncs automatically when reconnected. It includes a built-in **AI voice assistant** ("Hey LifeOS") powered by Groq via a Supabase Edge Function that understands free-form speech ("tomorrow I have dinner at 9 PM" → a timed task with an alarm) and can add/complete/delete tasks, toggle reminders, navigate, and summarize the day.

## All features (complete list)

**Core productivity**
- **Tasks**: create/edit/delete/duplicate; priorities (low→urgent); statuses (inbox/planned/in-progress/completed/cancelled); due dates & times; categories; projects; goals; subtasks; tags; drag-to-reorder; bulk select/complete/move/delete; occurrence overrides for recurring tasks.
- **Recurrence**: daily, weekdays, weekly (with weekday picker), monthly, yearly, custom anchors; per-occurrence completion tracking.
- **Quick Add**: natural-language parsing — "Finish assignment tomorrow at 7 PM !high #exam every wednesday /project:College" auto-extracts title, date, time, priority, tags, repeat, project, reminder minutes, estimated minutes.
- **Today page**: focused daily list with quick add, overdue panel, tomorrow count.
- **Calendar**: day/week/month views; tasks, schedule blocks, reminders, milestones; color filters; tap-to-add on a selected date.
- **Weekly planner**: schedule blocks per day, merged into Productivity's Plan view.
- **Routines** (Productivity tab): recurring routines with time-of-day, multi-weekday repeat, colors, per-day completion, native alarms.
- **Reminders**: standalone timed reminders with snooze and important flag.
- **Remember**: anniversaries (yearly/monthly) with day/time/note.
- **Notes**: folders, pinning, full-text editing.
- **Ideas**: capture with photo and voice attachments; convert to project.
- **Goals & Projects**: with milestones and progress.
- **Focus timer**: pomodoro-style sessions logged to stats.
- **Stats**: completion trends, focus time, streaks.
- **Review**: daily/weekly reflection flow.
- **Global search** across tasks/notes/ideas/projects.

**Platform & sync**
- **Offline-first engine**: local IndexedDB cache + outbox queue + Supabase Realtime + periodic pull; parked ("dead") ops with one-tap retry; sync badge with pending count and last error.
- **Auth**: email/password signup, login, forgot/reset; session persistence.
- **Installable everywhere**: PWA (service worker precache), Android APK (versionCode 20; native WebView shell with splash screen, pull-to-refresh-at-top, standalone display), Windows installer + portable (Electron, tray, native alarms).
- **Push/alarms that work with the app closed**: native Android AlarmManager exact alarms (setAlarmClock), 7-day scheduling horizon, boot persistence, per-task `remind_me` on/off, cross-device dismissal sync (turn off on one device = silent everywhere until next occurrence), snooze from notification, custom alarm sounds, full-screen alarm overlay in-app, desktop main-process timers.
- **Web push** for browsers via `send-push` Edge Function + pg_cron every minute + VAPID.

**AI & voice**
- **Voice assistant**: floating mic button (tap = talk, tap = stop), live partial-transcript captions, spoken (TTS) confirmations, wake word "Hey LifeOS" (customizable) with continuous listening in-app, **background wake-word foreground service** on Android (survives reboot, full-screen tap-to-speak popup on wake), native Android speech recognition bridge (WebView lacks Web Speech API), mic-permission request on first use.
- **AI brain (Groq llama via `assistant` Edge Function)**: free-form commands → tool calls with full app context (date/time, projects, categories, recent tasks, routines, current tab). Tools: add_task (with remind_me + reminder_minutes), add_note, add_reminder, complete_task, delete_task, set_reminder, navigate, open_app, summarize_day. Automatic model fallback; offline parser fallback when network fails.

**UI/UX**
- **4 premium themes**: Zen Paper, Deep Focus, Soft Nordic, Obsidian & Champagne + light/dark/system modes; full-app restyling via Tailwind 4 palette overrides; theme gallery with color-swatch previews in Settings.
- Modern design system (cards, chips, buttons, inputs, toasts, modals, skeletons, animations), safe-area insets, responsive mobile/desktop layouts, keyboard shortcuts (Ctrl+Enter quick add, Esc dialogs).
- **Settings**: account/profile, appearance, notifications (alert modes: notification-only / notification+alarm / off; default alarm sound picker; exact-alarm grant card), voice assistant (enable, AI on/off, wake word, background listening), categories & tags, data & sync (pull, retry parked, diagnostics), backup/export (JSON + tasks CSV), security (password change, sign out), about.

**Backend**
- Supabase Postgres with RLS on every table; schema: profiles, categories, tags, projects(+milestones), goals(+milestones), tasks, subtasks, task_tags, notes, ideas, remember_items, schedule_blocks, reminders, focus_sessions, routine_tasks, routine_completions, user_settings, alarm_dismissals, push_subscriptions.
- Edge Functions: `assistant` (Groq AI), `send-push` (Web Push cron).
- Migrations kept idempotent for existing projects (catch-up SQL files).

---

# 🔁 MASTER LOOP PROMPT — copy everything below and run it as one instruction

You are the maintainer of LifeOS (repo root = current project; live site https://life-os-tdl.vercel.app; Supabase project gzhqftvgvfqskatpqqie; report file `LifeOS-Test-Report.md`). Your job is to run an **endless verify-and-fix loop** until the report's bug list is empty and a fresh end-to-end pass is clean. Follow this cycle, repeating until everything passes:

1. **Read `LifeOS-Test-Report.md`** and fix the highest-severity unfixed bug. Known current bugs: (a) CRITICAL — `tag_ids` column missing from live `tasks` table breaking ALL task sync (client writes it in src/lib/db.ts ~line 557; fix with idempotent SQL migration + update supabase/schema.sql + verify the outbox flushes and a created task appears via Supabase REST); (b) completing a task does not update the UI's Completed view (re-test after (a); fix the optimistic update or filter); (c) signup email-confirmation dead end (surface the real Supabase error, or disable email confirmation, or set up SMTP); (d) silent 400s in console — surface sync errors as a user-visible toast/badge; (e) WeeklyPage fake toast shim at line ~69 — use the real app toast; (f) stale `theme-editorial` reference in store.tsx cleanup list; (g) verify the completed checkbox shows the correct checked state in All view.

2. **For each fix**: make the smallest change that fixes it; run `npx tsc --noEmit` (must be clean); run `npm run build` (must succeed); if Android files changed, rebuild the APK (clean assembleRelease, zipalign, apksigner with android.keystore alias lifeos pass lifeos123), bump versionCode, copy to public/LifeOS.apk, upload to the GitHub release (delete old LifeOS.apk asset, upload new), and commit+push to main (Vercel deploys automatically). If Supabase schema changed, write an idempotent migration file in supabase/ AND run it via the SQL editor instructions for the user, and update supabase/schema.sql.

3. **Verify end-to-end in a real browser** (preview tools): sign in with the test account (test.lifeos.dump@gmail.com / TestPass123!), Quick-Add a task with "tomorrow at 6 pm !high", confirm it parses, appears in Tasks→Upcoming, completes correctly and shows in Completed, AND appears via Supabase REST `GET /rest/v1/tasks` (sync proof). Check console for errors — zero tolerance.

4. **Update the report**: mark fixed bugs ✅ with evidence; add any NEW bugs discovered with severity, evidence, and fix plan. Never delete history — append.

5. **Loop back to step 1** until: zero console errors, task sync proven via REST, all views correct, report has no unfixed 🔴/🟠 items. Then do one final full regression pass (all pages render, quick add all 5 kinds, calendar, routines, settings toggles, download page links all 200, APK byte-check vs local build, assistant edge function returns a tool call for "add task dinner tomorrow at 9 pm") and write a "FINAL: ALL CLEAN" section with date. If anything regresses, the loop continues — never declare done with a known open bug.

Rules: never touch alarm logic (alarm.ts, notifications.ts ring paths, AlarmScheduler/AlarmReceiver/AlarmSoundService/NotifHelper) unless a report bug explicitly names them; never break the voice assistant pipeline; never lose offline-queued data (migrations must be additive; never wipe the outbox); always verify in the live site after pushing.
