# Tool catalogue — 71 capabilities

Auto-generated from the deployed contract. Each entry is one app action the companion can plan.

| Tool | What it does |
|---|---|
| `add_task` | Create one regular task (lives in Today/Tasks; completed with complete_task). Resolve dates locally; ask if time is ambiguous. |
| `update_task` | Rename, reschedule, reprioritize or reopen/complete one task. Null clears date/time. |
| `complete_task` | Complete one regular task — "mark done", "mark as done", "tick", "tick off", "check off", "mark complete" all mean this. |
| `delete_task` | Delete one task only on explicit request. |
| `set_reminder` | Enable/disable reminder preference on one existing task. Does not guarantee OS alarm delivery. |
| `set_recurrence` | Repeat one existing task. |
| `remove_recurrence` | Stop repeating one task, not the conversation. |
| `query_tasks` | Read task titles, dates, times and status; never infer from incomplete context. |
| `add_note` | Create a note. |
| `update_note` | Update only the supplied fields of one note. |
| `delete_note` | Delete one note, only on explicit request. |
| `query_notes` | List matching note titles and metadata. Private body text is not sent to the model. |
| `add_idea` | Create a idea. |
| `update_idea` | Update only the supplied fields of one idea. |
| `delete_idea` | Delete one idea, only on explicit request. |
| `query_ideas` | List matching idea titles and metadata. Private body text is not sent to the model. |
| `add_remember` | Create a remember. |
| `update_remember` | Update only the supplied fields of one remember. |
| `delete_remember` | Delete one remember, only on explicit request. |
| `query_remember` | List matching remember titles and metadata. Private body text is not sent to the model. |
| `add_reminder` | Create a reminder. |
| `update_reminder` | Update only the supplied fields of one reminder. done=true ends the whole reminder; use only for an explicit request to end it, not complete a recurring occurrence. |
| `delete_reminder` | Delete one reminder, only on explicit request. |
| `query_reminders` | List matching reminder titles and metadata. Private body text is not sent to the model. |
| `add_routine` | Create a routine — a repeating item on the Productivity page daily checklist. Needs days (weekdays) or extra_date (one specific day). |
| `update_routine` | Update only the supplied fields of one routine. |
| `delete_routine` | Delete one routine, only on explicit request. |
| `query_routines` | List matching routine titles and metadata. Private body text is not sent to the model. |
| `complete_routine` | Tick (done=true, default) or untick (done=false) one routine on the Productivity daily checklist for date (default today). Routines are Productivity-page items, not regular tasks. |
| `idea_to_project` | Convert one idea to a project. |
| `create_project` | Create a project. |
| `update_project` | Rename or change description, target date, priority or status of one project. |
| `delete_project` | Delete one project and its milestones; keeps tasks but unlinks them. |
| `query_projects` | List matching project names, status and target date. |
| `create_goal` | Create a goal. |
| `update_goal` | Rename or change description, deadline, horizon, progress or status of one goal. |
| `delete_goal` | Delete one goal and its milestones; keeps tasks but unlinks them. |
| `query_goals` | List matching goals with progress and deadlines. |
| `add_milestone` | Add a project or goal milestone. Only project milestones support due_date. |
| `update_milestone` | Rename, complete or reopen a milestone. Only project milestones support due_date. |
| `complete_milestone` | Complete a milestone under a uniquely named project or goal. |
| `delete_milestone` | Delete one milestone on explicit request. |
| `query_milestones` | Read milestones only within the specified project or goal. |
| `add_subtask` | Add a subtask under one uniquely matched task. |
| `query_subtasks` | List subtasks and completion state within one task. |
| `update_subtask` | Rename or complete/reopen one subtask within one task. |
| `delete_subtask` | Delete one subtask within one task, on explicit request. |
| `create_tag` | Create a tag by name. Existing tags are reused. Color is #RRGGBB. |
| `query_tags` | List tag names and colors. |
| `update_tag` | Rename or recolor one uniquely matched tag; cannot merge duplicate names. |
| `delete_tag` | Delete one tag and its task-tag links, keeping tasks. |
| `create_category` | Create a category by name. Existing tags are reused. Color is #RRGGBB. |
| `query_categories` | List category names and colors. |
| `update_category` | Rename or recolor one uniquely matched category; cannot merge duplicate names. |
| `delete_category` | Delete one unused, non-default category. Reassign linked tasks/blocks first. |
| `add_schedule_block` | Create a recurring weekly planner/calendar block. Times must be same-day, end after start. weekday is 0=Sun..6=Sat. |
| `query_schedule_blocks` | List planner/calendar blocks by title and/or weekday with times and recurrence. |
| `update_schedule_block` | Edit one planner block. match_weekday optionally disambiguates the existing block; weekday changes its day. Null clears links. |
| `delete_schedule_block` | Delete one planner block explicitly; optional match_weekday disambiguates titles. |
| `snooze_reminder` | Snooze one unfinished standalone reminder from now, in minutes (1..10080). |
| `complete_reminder` | Complete this reminder occurrence. Recurring reminders advance to the next future date; update_reminder(done=true) ends the entire reminder only when explicitly requested. |
| `set_task_relationships` | Assign or clear a task’s project, goal or category. Resolve names uniquely before any change; null unlinks. No tag replacement. |
| `set_task_tag` | Attach or detach one existing tag to/from one task, idempotently. Does not replace other tags. |
| `query_task_relationships` | Read a task’s project, goal, category and tag names without exposing IDs. |
| `navigate` | Open an app page; can also open a Tasks view (today/tomorrow/upcoming/inbox/overdue/completed/all/routines/reminders) or a Library tab. |
| `open_capture` | Open the idea-capture flow: live camera photo and/or a pausable voice note. |
| `open_app` | Focus LifeOS if already open; cannot control other apps. |
| `summarize_day` | Read today’s outstanding tasks and reminders. |
| `reschedule_task` | Move one overdue or open task to today, tomorrow, next week or a specific date (without changing anything else). |
| `query_stats` | Read progress numbers: completed today/this week/this month, completion rate, overdue and inbox counts, routine (Productivity) performance, and focus-timer minutes today/this week. |
| `capabilities` | Explain supported and unsupported assistant controls. |
