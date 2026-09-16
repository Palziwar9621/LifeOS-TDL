// LifeOS — backup: JSON export/import of all user data
import { dbState } from './db';

export interface BackupFile {
  app: 'LifeOS';
  version: 1;
  exported_at: string;
  data: Record<string, any[]>;
}

const TABLES = [
  'categories', 'tags', 'projects', 'project_milestones', 'goals', 'goal_milestones',
  'tasks', 'subtasks', 'task_tags', 'notes', 'ideas', 'remember_items',
  'schedule_blocks', 'reminders', 'focus_sessions',
];

export function exportAllJson(): string {
  const s = dbState();
  const data: Record<string, any[]> = {};
  for (const t of TABLES) data[t] = (s as any)[t] ?? [];
  const backup: BackupFile = {
    app: 'LifeOS',
    version: 1,
    exported_at: new Date().toISOString(),
    data,
  };
  return JSON.stringify(backup, null, 2);
}

export function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function tasksCsv(tasks: any[]): string {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['id', 'title', 'status', 'priority', 'due_date', 'due_time', 'recurrence', 'project_id', 'category_id', 'completed_at', 'created_at', 'notes'];
  const rows = tasks.map((t) => header.map((h) => esc(t[h])).join(','));
  return [header.join(','), ...rows].join('\n');
}

export function parseBackupJson(text: string): { data: Record<string, any[]> } | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.app !== 'LifeOS' || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read a File as text (for import). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}
