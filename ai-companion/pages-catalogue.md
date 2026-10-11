# Page-by-page capability catalogue

Scanned from the actual shipped UI. Each entry lists everything a user can do
on that page/tab — this is what the assistant is trained to cover.

## Home dashboard (src/app/pages/Dashboard.tsx)
- Greeting + today's progress ring (done/total, %) · "All done for today 🎉"
- Quick-add pills: Task, Note, Reminder, Project, Goal, Schedule (opens Planner)
- Today's tasks list (recurring shown per-occurrence; complete/edit rows)
- Overdue section → "Review" jumps to Tasks/overdue view
- Upcoming deadlines (next 5, with relative-day chips)
- Today's schedule (planner blocks sorted by start time)
- Active projects & goals with progress bars (top 3 each)
- Important reminders (max 3, shows snoozed/due time)
- "Get the app" pill (download page) — dismissible forever

## Today (TodayPage.tsx)
- Quick-add inline with natural parsing ("Gym at 6 pm every mon,wed,fri")
- Overdue strip (3 shown) → "Show all N overdue"
- Today's scheduled tasks + recurring occurrences, drag-reorder
- Completed-today section
- Empty state, per-row: complete, edit, recurrence aware

## Tasks (TasksPage.tsx)
- Views (tabs): Today, Tomorrow, Upcoming, Inbox, Overdue, Completed, All,
  Routines (embedded panel), Reminders (embedded panel)
- Search box · filters by priority/project/category/(All-view:) status
- Sort: Manual / Due date / Priority / Newest / Title
- Bulk mode: multi-select, bulk complete, bulk move-to-project,
  bulk delete (recurring occurrences skipped); New task modal
- Row actions: complete/uncomplete occurrence, edit, duplicate, drag order

## Calendar (CalendarPage.tsx)
- Day / Week / Month views; prev/next navigation; "Today" chip
- Item-type filters persisted across visits: Tasks, Blocks, Reminders, Milestones
- Day/week item chips open TaskEditor, BlockEditor or the exact reminder
- Month view color bars; pick a day → day view
- Remembers the selected date via the assistant context (context-aware adds)

## Productivity (ProductivityPage.tsx) — 3 views
- **Day**: daily routine checklist, tick/untick per selected date, %
  progress bar, all-done streak 🔥, week strip with per-day dots, back-to-today
- **Week**: Mon..Sun grid, per-day "N/M done", add-on-this-day (+) per day,
  chip style tick/untick with keyboard support, routine color chips, edit pencil
- **Plan**: WeeklyPlanPanel — schedule/blocks grid
- Editor fields: title, weekly vs one-off, multi-day repeat, time of day,
  7 palette colors, per-routine alarm sound (click to hear)
- Routine deletes confirm (removes check-off history)

## Planner blocks (WeeklyPage.tsx / BlockEditor)
- 7-day grid; blocks colored, "↔ linked task" markers
- Editor: title, multi-day creation (one block per picked day), start/end
  times, 8-color palette, repeats (weekly/daily/even/odd weeks), link a task,
  notes; edit keeps its own day; delete

## Projects (ProjectsPage.tsx)
- Status filter: active/planning/idea/on_hold/completed/archived/all; New project
- Card: color dot, name, status chip, priority chip, target-date chip,
  progress (tasks+milestones), expandable details
- Details: milestone checkboxes, add milestone inline, delete milestone,
  linked task rows (open editor), project edit/delete-confirm
- Editor: name, description, status, priority, start & target dates, 8 colors

## Goals (GoalsPage.tsx)
- Filter active/completed/archived/all; New goal
- Card: horizon chip (Long-term/Yearly/Monthly/Weekly), deadline chip,
  status chip, progress (milestones + linked tasks)
- Milestones: checkbox complete, inline add, delete; related tasks (max 5) open editor
- Editor: title, description, horizon, target date, 8 colors; delete-confirm

## Library (LibraryPage.tsx) — 3 tabs
- **Notes**: search, folder filter, Active/Archived views, pinned section,
  pin/favorite per card, linked-item chips (↔ task/project/goal), tag chips
  - Editor: title, content (checklist-style first line), folder, tags,
    link to task/project/goal, archive, delete
- **Ideas**: status filter (open/specific/all), search, Capture (camera+voice
    modal: live viewfinder, flip, shutter, pausable voice note up to 2 min),
    photo preview, audio player + duration chip, priority/effort/possible-start/
    target chips, "Make it a project" (if not converted yet), editor with
    why/notes/links/status/priority/effort/dates, delete-confirm
- **Remember**: search, category filter, pinned section, pin/favorite,
    anniversary card strip (🎂 next 3, "TODAY"/"Tomorrow"/"in Nd")
  - Editor: title, monospace content (principles/checklists), category, tags,
    yearly/monthly anniversary alarm (date + time + custom note)

## Reminders (RemindersPage.tsx)
- Full page + embedded Tasks tab; open/done/all filter; New reminder
- Row: complete circle (reopen instantly), ⭐ important marker, snoozed tag,
  recurrence label with custom days, quick snooze 10m/1h/1d, delete-confirm
- Editor: title, date, time, priority, link to task, notes, repeat
  (once/daily/weekdays/weekly/custom-days/monthly/yearly), per-item alarm
  sound, important checkbox (dashboard card)
- Notification-permission banner with one-tap Enable
- Deep link: calendar reminder chip opens the exact editor

## Insights (StatsPage.tsx) — 2 tabs
- **Statistics**: cards (completed today/week/month, completion rate %),
  Daily-routine section (today %, streak, active routines, per-weekday
  completion bars, 14-day tick bars), last-14-days bar chart, most productive
  weekday bars, open-tasks-by-priority bars, completions by category bars,
  project progress bars, focus minutes today/this week + inbox/overdue counts
- **Review** (ReviewPage panel): daily review (completed today, incomplete
  with →Tomorrow push, overdue with →Today/→Tomorrow, tomorrow list, upcoming
  deadlines) and weekly review (completed this week, carried-forward with
  →Next week push, project %, goal %, next week's schedule)

## Focus (FocusPage.tsx)
- Timer ring; pick an open task or general session; Pomodoro/Custom mode;
  focus minutes (1..180) & break minutes (1..60)
- Start / Pause / Resume / Finish / Stop; auto break countdown;
  "Mark task complete" after a session; sessions log to Insights focus stats

## Search (SearchPage.tsx)
- Global search across tasks, projects, goals, notes, ideas, remember items,
  schedule blocks, reminders; kind chips; opens item editor or page

## Settings — 9 sections (SettingsPage.tsx)
- **Account**: username, avatar URL, email (read-only), Save profile
- **Appearance**: app language (multi), light/dark/system mode, premium themes
  (Kage 影 ink-black ambient, Obsidian & Champagne gold) with live swatches
- **Notifications**: alert mode (notification-only / +alarm / off),
  reminder notifications toggle, default alarm-sound picker (click to hear),
  exact-alarm grant card (Android), web-push subscribe/test/unsubscribe or
  native-alarm status per environment
- **Voice Assistant**: test-voice-output button, enable toggle, wake-mode
  (foreground consent, remembered), AI-understanding (Groq) toggle, wake-word
  field (customizable), Android background listen-when-closed toggle,
  "what you can say" help box, recent voice-pipeline timings (no transcripts)
- **Categories & Tags**: recolor/rename/delete (confirm) categories,
  create category, list+delete tags, create tag
- **Data & Sync**: online status, pending changes, retry parked changes,
  last sync error + migration hint, backend host, Sync now
- **Backup & Export**: export all JSON, export tasks CSV, import JSON (merge)
- **Security**: change password (2 fields + validation), sign out (confirm),
  delete account (type DELETE, double confirm)
- **About**: blurb, Get the app, replay tutorial, version

## Shell (global)
- Sidebar nav + mobile bottom bar + More sheet, quick-add modal (Ctrl+K / +),
  global search (Ctrl+F), sync badge (click to sync now / shows errors),
  idea capture modal, floating mic (tap once = start voice chat, tap again =
  stop); wake-mode pill; tutorial gate with replay
