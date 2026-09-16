// LifeOS — shared domain types
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'inbox' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type ProjectStatus = 'idea' | 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
export type IdeaStatus = 'idea' | 'someday' | 'planned' | 'ready_to_start' | 'active' | 'completed' | 'abandoned';
export type GoalHorizon = 'long_term' | 'yearly' | 'monthly' | 'weekly';
export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type ReminderRecurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type ScheduleRecurrence = 'weekly' | 'even_weeks' | 'odd_weeks' | 'daily';

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;        // yyyy-MM-dd
  due_time: string | null;        // HH:mm:ss
  start_time: string | null;      // HH:mm:ss
  category_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  recurrence: Recurrence | null;
  recurrence_days: number[] | null;
  recurrence_monthday: number | null;
  recurrence_anchor: string | null;
  completed_occurrences: Record<string, true>;
  occurrence_overrides: Record<string, OccurrenceOverride>;
  reminder_minutes: number | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  sort_order: number;
  completed_at: string | null;    // ISO timestamp
  completed_at_date: string | null;
  archived: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  // client-side joins
  subtasks?: Subtask[];
  tag_ids?: string[];
}

export interface OccurrenceOverride {
  title?: string;
  notes?: string;
  due_date?: string | null;
  due_time?: string | null;
  priority?: Priority;
  status?: TaskStatus;
}

export interface Subtask {
  id: string;
  user_id: string;
  task_id: string;
  title: string;
  done: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  milestones?: ProjectMilestone[];
}

export interface ProjectMilestone {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  done: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  horizon: GoalHorizon;
  deadline: string | null;
  progress: number;
  status: 'active' | 'completed' | 'archived';
  color: string;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  milestones?: GoalMilestone[];
}

export interface GoalMilestone {
  id: string;
  user_id: string;
  goal_id: string;
  title: string;
  done: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  folder: string | null;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  deleted: boolean;
  tags: string[];
  linked_task_id: string | null;
  linked_project_id: string | null;
  linked_goal_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Idea {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  why: string | null;
  notes: string | null;
  links: string | null;
  status: IdeaStatus;
  priority: Priority;
  effort: 'xs' | 's' | 'm' | 'l' | 'xl' | null;
  possible_start: string | null;
  target_date: string | null;
  converted_project_id: string | null;
  photo_data: string | null;      // data:image/jpeg;base64,… (instant-capture photo)
  voice_data: string | null;      // data:audio/…;base64,… (instant-capture voice note)
  voice_duration_secs: number | null;
  archived: boolean;
  deleted: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RememberItem {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  deleted: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleBlock {
  id: string;
  user_id: string;
  title: string;
  weekday: number; // 0=Sunday..6=Saturday
  start_time: string;
  end_time: string;
  category_id: string | null;
  color: string;
  icon: string | null;
  notes: string | null;
  recurrence: ScheduleRecurrence;
  linked_task_id: string | null;
  deleted: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  due_at: string; // ISO
  priority: Priority;
  important: boolean;
  done: boolean;
  snoozed_until: string | null;
  recurrence: ReminderRecurrence | null;
  task_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  deleted: boolean;
  fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoutineTask {
  id: string;
  user_id: string;
  title: string;
  /** 0=Sunday..6=Saturday; null when this is a custom extra-date task. */
  weekday: number | null;
  /** Extra one-off date (custom day task) — repeats every week on that date? No: one specific date. */
  extra_date: string | null;
  time_of_day: string | null;   // HH:mm:ss
  color: string;
  archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RoutineCompletion {
  id: string;
  user_id: string;
  task_id: string;
  done_date: string;            // yyyy-MM-dd
  created_at: string;
}

export interface FocusSession {
  id: string;
  user_id: string;
  task_id: string | null;
  mode: 'pomodoro' | 'custom';
  duration_minutes: number;
  completed_minutes: number;
  completed: boolean;
  started_at: string;
  ended_at: string | null;
}

export interface Profile {
  id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type EntityKind =
  | 'tasks' | 'subtasks' | 'projects' | 'project_milestones' | 'goals' | 'goal_milestones'
  | 'notes' | 'ideas' | 'remember_items' | 'schedule_blocks' | 'reminders'
  | 'categories' | 'tags' | 'task_tags' | 'focus_sessions'
  | 'routine_tasks' | 'routine_completions';

export const PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

export const PRIORITY_ICON: Record<Priority, string> = {
  low: '↓', medium: '=', high: '↑', urgent: '‼',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: 'Inbox', planned: 'Planned', in_progress: 'In Progress',
  completed: 'Completed', cancelled: 'Cancelled',
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: 'Idea', planning: 'Planning', active: 'Active',
  on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
};

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  idea: 'Idea', someday: 'Someday', planned: 'Planned', ready_to_start: 'Ready to Start',
  active: 'Active', completed: 'Completed', abandoned: 'Abandoned',
};

export const EFFORT_LABEL: Record<string, string> = {
  xs: 'XS · minutes', s: 'S · a few hours', m: 'M · a day or two',
  l: 'L · about a week', xl: 'XL · multi-week',
};
