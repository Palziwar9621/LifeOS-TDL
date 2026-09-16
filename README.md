# LifeOS

**A local-first personal productivity system.** Tasks, routines, weekly planning, projects, goals, notes, ideas, "Things to Remember", a calendar, reminders with alarm sounds, focus sessions and gentle statistics — one account, every device.

![LifeOS](public/icon.svg)

---

## Why it's built this way

LifeOS is a **local-first PWA**:

- **Everything works offline.** Reads and writes hit an on-device database (IndexedDB) first; changes sync to Supabase (Postgres) automatically when you're online. A durable outbox queues every edit, so nothing is ever lost to a dropped connection.
- **One codebase, every platform.** Installable as a desktop app on Windows (Chrome/Edge → *Install app*) and as an app on Android (Chrome → *Add to Home screen*, or package an APK via PWABuilder).
- **Security by isolation.** Supabase Row Level Security means every query is automatically scoped to the signed-in user — one user can never read another's rows, even with the public anon key.

The same account works on Windows and Android: create a task on one, complete it on the other — in seconds, via realtime sync.

---

## Features

| Area | What you get |
|---|---|
| **Dashboard** | Time-aware greeting, today's progress bar, today's tasks, overdue, upcoming deadlines, today's schedule, active projects/goals, important reminders, quick actions (+ Task/Note/Reminder/Project/Goal/Schedule) |
| **Tasks** | Title, notes, due date & time, start time, priority (Low/Medium/High/Urgent with icons + text), category, project, goal link, tags, subtasks, reminders, estimated duration, statuses (Inbox/Planned/In Progress/Completed/Cancelled), complete/undo, duplicate, snooze/reschedule, drag-and-drop ordering, bulk actions |
| **Views** | Today · Tomorrow · Upcoming · Inbox · Overdue · Completed · All · 🔔 Reminders, plus filters (priority, project, category, status), sorting, and search |
| **Smart add** | Type `Finish Laplace assignment tomorrow at 7 PM !high #exam` — dates, times, priority, repeat rules, tags and durations are parsed offline, with a live preview of what was detected |
| **Recurring tasks** | Daily / weekdays / weekly (pick days) / monthly (day-of-month) / yearly / custom multi-day (e.g. Mon+Tue+Wed). Completions are tracked per-occurrence so finishing today keeps future dates intact |
| **Projects** | Statuses (Idea→Planning→Active→On Hold→Completed→Archived), priority, dates, color, milestones with due dates, linked tasks, visual progress |
| **Goals** | Long-term / yearly / monthly / weekly horizons, deadline, milestones, related tasks, progress |
| **Ideas & Future** | Someday/maybe parking lot with its own statuses and effort estimates. **One button converts an idea into an active project.** **Instant capture:** live camera viewfinder (frame the shot, then shutter) + voice notes with pause/resume — auto-compressed, synced everywhere |
| **Remember** | Permanent knowledge: principles, rules, checklists. Pin, favorite, categories, tags, search — plus **anniversary alarms** (birthdays, bills, renewals) that repeat yearly or monthly with a live countdown |
| **Notes** | Folders, tags, pin, favorite, archive, search, links to task/project/goal |
| **Productivity** | Your daily routine hub with three views: **Day** (tick off today / any day), **Week** (routine grid across Mon–Sun), **Plan** (the weekly schedule planner). Multi-weekday repeats, per-day progress, streaks, custom alarm sounds |
| **Weekly planner** | 7-day grid of time blocks (College 8–2, Gym 4–5:30…), colors, recurrence, optional task link, multi-day creation — deliberately a different concept from tasks |
| **Calendar** | Day / week / month views showing tasks, recurring occurrences, schedule blocks, reminders, and project milestones |
| **Reminders** | Independent time-based reminders with snooze (10m/1h/1d), important flag, custom-days recurrence that rolls forward on completion, and browser notifications |
| **Alarms** | 6 built-in sounds (Chime, Birdsong, Marimba, Sunrise, Pulse, Digital — synthesized on-device), looping until dismissed, per-reminder / per-routine pickers with preview, plus a default in Settings |
| **Focus** | Pomodoro or custom timer with a task picker, progress ring, pause/resume, session logging |
| **Reviews** | Daily review (completed/incomplete/overdue + one-tap reschedule) and weekly review (carried forward, projects/goals progress, next week) — inside Insights |
| **Insights** | Statistics + Review in one place: completed today/week/month, completion rate, 14-day charts, best weekdays, by category & priority, project progress, focus minutes, and a full **Daily routine** panel (today %, streak, per-weekday consistency, routine-tick chart) |
| **Library** | Notes + Ideas + Remember in one hub with tabs |
| **Search** | One search across tasks, projects, goals, notes, ideas, Remember items, schedule blocks and reminders |
| **Offline & sync** | Full offline support; outbox queues changes; realtime updates between devices; last-write-wins with local-pending protection; pending badge shows the reason if sync fails |
| **Backup** | Export everything as JSON, tasks as CSV, import JSON backups (merge, newest-wins) |
| **Settings** | Profile & avatar URL, appearance (light/dark/system, remembered), notifications & default alarm sound, categories & tags management, sync status with error details, security (password change, sign-out), about |
| **Design** | Modern quiet-neutral theme, layered soft cards, indigo accent, full dark mode, keyboard shortcuts (Ctrl+K quick add, Ctrl+F search), large touch targets, aria labels, priority shown with icons + text (never color alone) |

---

## Tech stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS 4
- **Local store:** IndexedDB (cache) + in-memory reactive store + durable outbox
- **Backend:** Supabase — Postgres, Auth (email/password), Realtime, RLS
- **PWA:** `vite-plugin-pwa` (service worker, manifest, installable)

---

## Quick start (local development)

```bash
# 1. install
npm install

# 2. create your Supabase backend (2 minutes, free):
#    a. create a project at https://supabase.com
#    b. SQL Editor → paste supabase/schema.sql → Run
#    c. Project Settings → API → copy the Project URL and anon public key
#    d. Authentication → Sign In / Up → Email: enable, and turn "Confirm email" OFF
#       (or configure SMTP and keep confirmation on)

# 3. configure (pick one):
#    - Environment: copy .env.example → .env and fill it, OR
#    - In-app: launch the app and enter URL + anon key on the Setup screen

# 4. open http://localhost:5173, sign up, and start planning
npm run dev
```

> Demo mode: append `#demo` to the URL to explore the app with local-only sample data — no Supabase needed.

---

## Environment variables

`.env` (copy from `.env.example`):

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- The URL must end at `.supabase.co` — no `/rest/v1/` suffix, no trailing paths.
- These are **public client values** — the Supabase anon key is designed to be shipped in browsers; RLS protects the data.
- Never put the Supabase `service_role` key anywhere in this app.
- If no `.env` is present, the app shows its Setup screen and stores the config in `localStorage` instead.
- To change the backend later: Settings shows the connected project; clearing site data resets the app.

---

## Database schema

Run `supabase/schema.sql` once per Supabase project. It creates:

- **Tables:** `profiles`, `categories`, `tags`, `tasks`, `task_tags`, `subtasks`, `projects`, `project_milestones`, `goals`, `goal_milestones`, `notes`, `ideas`, `remember_items`, `schedule_blocks`, `reminders`, `routine_tasks`, `routine_completions`, `focus_sessions`, `user_settings`
- **Security:** RLS on every table with `user_id = auth.uid()` policies; profiles trigger on signup
- **Automation:** `updated_at` triggers, realtime publication for all tables
- **Extras:** replica identity full on hot tables so deletes sync too

### Migrations for existing projects

If your project was created before a schema change, run the matching file in `supabase/` (SQL Editor → paste → Run):

| File | Adds |
|---|---|
| `migration-idea-media.sql` | Photo/voice media columns on ideas |
| `migration-productivity.sql` | `routine_tasks` + `routine_completions` tables |
| `migration-alarms-anniversaries.sql` | Alarm sound fields + anniversary fields on Remember items |
| `migration-multiday-repeat.sql` | Multi-weekday repeat (`days`, `recurrence_days`) |

All migrations are idempotent — safe to run again.

---

## Deploy to production (Vercel)

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Add environment variables (Project → Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = your Project URL (ends at `.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
   - Mark both for **Production** (and Preview).
4. Deploy. Every `git push` to `main` redeploys automatically.

**Supabase side:** Authentication → URL Configuration → add your Vercel URL as a **Site URL** (and to redirect URLs) so login works from the deployed domain.

---

## Install as an app

### Windows desktop
1. Open your deployed URL in Chrome or Edge → menu → **Install app**.
2. You get a standalone window, taskbar icon, Start-menu entry — executable-like experience with notifications.
3. Prefer a real `.exe`? [PWABuilder](https://www.pwabuilder.com/) → Windows → packages an installable `.exe`/appx from the same URL.

### Android
1. Chrome on Android → open the URL → **⋮ → Add to Home screen / Install app**.
2. Full-screen app, offline capable, home-screen icon.
3. For an APK/AAB: [PWABuilder](https://www.pwabuilder.com/) → Android → download a signed APK/AAB ready for Play Store.

### iOS
The same PWA installs via Safari → Share → **Add to Home Screen**.

---

## Testing checklist

Major flows, in order (each should work):

1. **Setup** — paste URL + anon key → "Connect" → auth screen.
2. **Register** — sign up with email/password/username → lands on dashboard. If "Confirm email" is on, you'll be told to confirm first.
3. **Login / Logout / Login** — sign out from the sidebar; sign back in; data returns.
4. **Create task** — Today page: type `Finish Laplace assignment tomorrow at 7 PM !high` → Enter → appears with parsed date/time/priority.
5. **Edit task** — click a task → change fields → Save.
6. **Complete / undo** — checkbox on/off; recurrence-aware.
7. **Recurring task** — add "Gym every mon,wed,fri" → appears in Today on matching days only; completing today keeps future occurrences.
8. **Routine (Productivity)** — add a routine repeating on Mon+Tue+Wed → tick it in Day view; see the Week grid; add a schedule block in Plan view.
9. **Projects** — create project → add milestones → add tasks via Tasks page → progress updates.
10. **Goals** — create goal + milestones → progress = milestones+tasks.
11. **Notes / Remember / Ideas** — create each (Library page); pin; search; convert an idea to a project; set a birthday anniversary on a Remember item.
12. **Reminders** — create one due in 2 minutes with an alarm sound; enable notifications; see it fire; snooze; complete (recurring ones roll forward).
13. **Calendar** — switch day/week/month; click a task chip to edit.
14. **Search** — find items across sections; result type is labeled.
15. **Focus** — pick a task, run a short timer, see it logged in Insights.
16. **Dark mode** — Settings → Appearance → Dark; reloads stay dark.
17. **Offline** — DevTools → Network → Offline; create/edit/complete tasks; go online → changes sync (pending badge clears).
18. **Cross-device sync** — sign in on a second device with the same account → data appears; complete a task on device B → appears completed on device A within seconds (realtime).

---

## Project structure

```
src/
  app/            # screens & flow (store, shell, auth, quick add, task editor/row,
                  # idea capture, alarm sound picker)
  app/pages/      # Dashboard, Today, Tasks, Calendar, Productivity, Projects, Goals,
                  # Library (Notes/Ideas/Remember), Insights (Stats/Review), Focus,
                  # Reminders, Search, Settings
  lib/            # domain: types, dates, recurrence, quickadd parser,
                  # supabase client, idb cache, outbox, db store, auth,
                  # notifications, alarm sounds, media capture, backup, stats
  ui/             # design system (index.css) + shared components
supabase/         # schema.sql + migrations — run once each in the Supabase SQL editor
scripts/          # icon generator (no deps)
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the server" on signup | Check `VITE_SUPABASE_URL` — must end at `.supabase.co` with nothing after it. Redeploy after changing env vars. |
| Login works but changes stay "pending" | A migration is missing — run the latest file from `supabase/` in the SQL Editor. Settings → Data & Sync shows the exact error. |
| "Invalid API key" | The anon key doesn't belong to that project. Re-copy both values from the same project. |
| No notifications | Browser blocked them — allow notifications for the site (Android: Settings → Apps → LifeOS → Notifications). |
| PWA shows an old version | Hard refresh (Ctrl+Shift+R), or clear site data to reset the service worker. |

---

## Design principles

- **Function over decoration.** No fake buttons; every control does its job.
- **Local-first integrity.** The UI never waits on the network to record your intent.
- **Quiet, modern look.** Soft layered cards, crisp typography, one refined accent color, generous spacing.
- **Accessible.** Keyboard shortcuts, aria labels, text + icon (never color-only) indicators, large touch targets.
