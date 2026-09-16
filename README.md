# LifeOS

**A local-first personal productivity system.** Tasks, projects, goals, notes, ideas, "Things to Remember", a weekly planner, calendar, reminders, focus sessions and gentle statistics — one account, every device.

![LifeOS](public/icon.svg)

---

## Why it's built this way

LifeOS is a **local-first PWA**:

- **Everything works offline.** Reads and writes hit an on-device database (IndexedDB) first; changes sync to Supabase (Postgres) automatically when you're online.
- **One codebase, every platform.** Installable as a desktop app on Windows (Chrome/Edge → *Install app*) and as an app on Android (Chrome → *Add to Home screen*, or package an APK via PWABuilder).
- **Security by isolation.** Supabase Row Level Security means every query is automatically scoped to the signed-in user — one user can never read another's rows, even with the anon key.

The same account works on Windows and Android: create a task on one, complete it on the other.

---

## Features

| Area | What you get |
|---|---|
| **Dashboard** | Time-aware greeting, today's progress bar, today's tasks, overdue, upcoming deadlines, today's schedule, active projects/goals, important reminders, quick actions (+ Task/Note/Reminder/Project/Goal/Schedule) |
| **Tasks** | Title, notes, due date & time, start time, priority (Low/Medium/High/Urgent with icons + text), category, project, goal link, tags, subtasks, reminders, estimated duration, statuses (Inbox/Planned/In Progress/Completed/Cancelled), complete/undo, duplicate, snooze/reschedule, drag-and-drop ordering, bulk actions |
| **Views** | Today · Tomorrow · Upcoming · Inbox · Overdue · Completed · All, plus filters (priority, project, category, status) and sorting, and search |
| **Smart add** | Type `Finish Laplace assignment tomorrow at 7 PM !high #exam` — dates, times, priority, repeat rules, tags and durations are parsed offline, with a live preview of what was detected |
| **Recurring tasks** | Daily / weekdays / weekly (pick days) / monthly (day-of-month) / yearly / custom. Completions are tracked per-occurrence so finishing today keeps future dates intact |
| **Projects** | Statuses (Idea→Planning→Active→On Hold→Completed→Archived), priority, dates, color, milestones with due dates, linked tasks, visual progress |
| **Goals** | Long-term / yearly / monthly / weekly horizons, deadline, milestones, related tasks, progress |
| **Ideas & Future** | Someday/maybe parking lot with its own statuses and effort estimates. **One button converts an idea into an active project.** |
| **Remember** | Permanent knowledge: principles, rules, checklists. Pin, favorite, categories, tags, search |
| **Notes** | Folders, tags, pin, favorite, archive, search, links to task/project/goal |
| **Weekly planner** | 7-day grid of time blocks (College 8–2, Gym 4–5:30…), colors, recurrence, optional task link — deliberately a different concept from tasks |
| **Calendar** | Day / week / month views showing tasks, recurring occurrences, schedule blocks, reminders, and project milestones |
| **Reminders** | Independent time-based reminders with snooze (10m/1h/1d), important flag, recurrence option, and browser notifications (with permission handling) |
| **Focus** | Pomodoro or custom timer with a task picker, progress ring, pause/resume, session logging |
| **Reviews** | Daily review (completed/incomplete/overdue + one-tap reschedule) and weekly review (carried forward, projects/goals progress, next week) |
| **Statistics** | Completed today/week/month, completion rate, 14-day chart, best weekdays, by category & priority, project progress, focus minutes — deliberately *not* a stressful score |
| **Search** | One search across tasks, projects, goals, notes, ideas, Remember items, schedule blocks and reminders |
| **Offline & sync** | Full offline support; outbox queues changes; realtime updates between devices; last-write-wins with local-pending protection; pending-count badge and manual "Sync now" |
| **Backup** | Export everything as JSON, tasks as CSV, import JSON backups (merge, newest-wins) |
| **Settings** | Profile & avatar URL, appearance (light/dark/system, remembered), notifications, categories & tags management, sync status, security (password change, sign-out), about |
| **Design** | Modern quiet-neutral theme, layered soft cards, indigo accent, full dark mode, keyboard shortcuts (Ctrl+K quick add, Ctrl+F search), large touch targets, aria labels, priority shown with icons + text (never color alone) |

---

## Tech stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS 4
- **Local store:** IndexedDB (cache) + in-memory reactive store + durable outbox
- **Backend:** Supabase — Postgres, Auth (email/password), Realtime, RLS
- **PWA:** `vite-plugin-pwa` (service worker, manifest, installable)

---

## Quick start

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
npm run dev

# 4. open http://localhost:5173, sign up, and start planning
```

The in-app Setup screen tests your connection before saving, and includes the same instructions inline.

---

## Environment variables

`.env` (copy from `.env.example`):

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- These are **public client values** — the Supabase anon key is designed to be shipped in browsers; RLS protects the data.
- Never put the Supabase `service_role` key anywhere in this app.
- If no `.env` is present, the app shows its Setup screen and stores the config in `localStorage` instead.
- To change the backend later: Settings shows the connected project; clearing site data resets the app.

---

## Database schema

Run `supabase/schema.sql` once per Supabase project. It creates:

- **Tables:** `profiles`, `categories`, `tags`, `tasks`, `task_tags`, `subtasks`, `projects`, `project_milestones`, `goals`, `goal_milestones`, `notes`, `ideas`, `remember_items`, `schedule_blocks`, `reminders`, `focus_sessions`, `user_settings`
- **Security:** RLS on every table with `user_id = auth.uid()` policies; profiles trigger on signup
- **Automation:** `updated_at` triggers, default `updated_at` handling, realtime publication for all tables
- **Extras:** replica identity full on hot tables so deletes sync too

Users are created via Supabase Auth; a `profiles` row is auto-created with their username/email.

---

## Build & deploy

```bash
npm run build      # production build → dist/ (with service worker + manifest)
npm run preview    # serve the build locally
```

### Windows desktop app
1. `npm run build`
2. Deploy `dist/` to any HTTPS host (Vercel/Netlify/Cloudflare Pages — all free).
3. Open the URL in Chrome or Edge → menu → **Install app** (or *Create shortcut → Open as window*).
   You get a standalone window, taskbar icon, start-menu entry — an executable-like experience with notifications.
4. Prefer a real `.exe`? Host the PWA and run [PWABuilder](https://www.pwabuilder.com/) → Windows → it packages an installable `.exe`/appx from the same URL.

### Android app
1. Deploy the same `dist/` to HTTPS.
2. Chrome on Android → open the URL → **Add to Home screen** → full-screen app, offline capable.
3. For an APK/AAB: [PWABuilder](https://www.pwabuilder.com/) → Android → download a signed APK/AAB ready for Play Store.

> PWABuilder requires your deployed URL — no code changes needed. The manifest, icons (192/512 + maskable), service worker, offline support and theme colors are all included.

### iOS note
Not requested, but the same PWA also installs on iOS via Safari → Share → Add to Home Screen.

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
8. **Projects** — create project → add milestones → add tasks via Tasks page (set project) → progress updates.
9. **Goals** — create goal + milestones → progress = milestones+tasks.
10. **Notes / Remember / Ideas** — create each; pin; search; convert an idea to a project.
11. **Weekly plan** — add blocks on different days; they show in Calendar week view and Dashboard "Today's schedule".
12. **Reminders** — create one due in 2 minutes; enable notifications; see it fire; snooze; complete.
13. **Calendar** — switch day/week/month; click a task chip to edit.
14. **Search** — find items across sections; result type is labeled.
15. **Focus** — pick a task, run a short timer, see it logged in Statistics.
16. **Dark mode** — Settings → Appearance → Dark; reloads stay dark.
17. **Offline** — DevTools → Network → Offline; create/edit/complete tasks; go online → changes sync ("N changes pending" badge clears).
18. **Cross-device sync** — sign in on a second device/browser with the same account → data appears; complete a task on device B → appears completed on device A within seconds (realtime).

---

## Project structure

```
src/
  app/            # screens & flow (store, shell, auth, quick add, task editor/row)
  app/pages/      # Dashboard, Today, Tasks, Calendar, Weekly, Projects, Goals,
                  # Notes, Ideas, Remember, Stats, Focus, Reminders, Review, Search, Settings
  lib/            # domain: types, dates, recurrence, quickadd parser,
                  # supabase client, idb cache, outbox, db store, auth,
                  # notifications, backup, stats
  ui/             # design system (index.css) + shared components
supabase/         # schema.sql — run once in the Supabase SQL editor
scripts/          # icon generator (no deps)
```

---

## Design principles

- **Function over decoration.** No fake buttons; every control does its job.
- **Local-first integrity.** The UI never waits on the network to record your intent.
- **Quiet, modern look.** Soft layered cards, crisp typography, one refined accent color, generous spacing.
- **Accessible.** Keyboard shortcuts, aria labels, text + icon (never color-only) indicators, large touch targets.
