// LifeOS — statistics selectors (all client-side, no scoring pressure)
import { dbState } from './db';
import { todayStr, addDays, parseDateStr, startOfWeek } from './dates';

export interface StatsBundle {
  todayCount: number;
  weekCount: number;
  monthCount: number;
  completionRate: number;
  overdueCount: number;
  inboxCount: number;
  byWeekday: number[];
  byCategory: { name: string; count: number; color: string }[];
  byPriority: { label: string; icon: string; color: string; count: number }[];
  activeProjects: { id: string; name: string; progress: number; color: string }[];
  last14: { date: string; count: number }[];
  focusMinutesToday: number;
  focusMinutesWeek: number;
}

export function computeStats(): StatsBundle {
  const s = dbState();
  const today = todayStr();
  const weekStart = startOfWeek(today, 1);
  const month = today.slice(0, 7);

  const doneToday = s.tasks.filter((t) => t.completed_at_date === today);
  const doneThisWeek = s.tasks.filter((t) => t.completed_at_date && t.completed_at_date >= weekStart && t.completed_at_date <= today);
  const doneThisMonth = s.tasks.filter((t) => t.completed_at_date?.startsWith(month));

  const openTasks = s.tasks.filter((t) => !t.deleted && !t.archived && t.status !== 'completed' && t.status !== 'cancelled');
  const overdue = openTasks.filter((t) => t.due_date && t.due_date < today);
  const completedAll = s.tasks.filter((t) => t.status === 'completed');
  const completionRate = (completedAll.length + openTasks.length) === 0
    ? 0
    : Math.round((completedAll.length / (completedAll.length + openTasks.length)) * 100);

  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const t of s.tasks) {
    if (!t.completed_at_date) continue;
    byWeekday[parseDateStr(t.completed_at_date).getDay()] += 1;
  }

  const byCategoryMap = new Map<string, { count: number; color: string }>();
  for (const t of s.tasks) {
    if (!t.completed_at_date) continue;
    const cat = s.categories.find((c) => c.id === t.category_id);
    const name = cat?.name ?? 'No category';
    const color = cat?.color ?? '#94a3b8';
    const cur = byCategoryMap.get(name) ?? { count: 0, color };
    cur.count += 1;
    byCategoryMap.set(name, cur);
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const prioDefs: Array<{ key: 'urgent' | 'high' | 'medium' | 'low'; label: string; icon: string; color: string }> = [
    { key: 'urgent', label: 'Urgent', icon: '‼', color: '#dc2626' },
    { key: 'high', label: 'High', icon: '↑', color: '#ea580c' },
    { key: 'medium', label: 'Medium', icon: '=', color: '#ca8a04' },
    { key: 'low', label: 'Low', icon: '↓', color: '#16a34a' },
  ];
  const byPriority = prioDefs.map((p) => ({
    label: p.label,
    icon: p.icon,
    color: p.color,
    count: openTasks.filter((t) => t.priority === p.key).length,
  }));

  const activeProjects = s.projects
    .filter((p) => p.status === 'active' && !p.archived)
    .map((p) => {
      const tasks = s.tasks.filter((t) => t.project_id === p.id && !t.deleted && !t.archived);
      const total = tasks.length;
      const done = tasks.filter((t) => t.status === 'completed').length;
      const ms = s.project_milestones.filter((m) => m.project_id === p.id);
      const msDone = ms.filter((m) => m.done).length;
      const progress = tasks.length > 0
        ? Math.round((done / total) * 100)
        : ms.length > 0 ? Math.round((msDone / ms.length) * 100) : 0;
      return { id: p.id, name: p.name, progress, color: p.color };
    });

  const last14: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const count = s.tasks.filter((t) => t.completed_at_date === d).length;
    last14.push({ date: d, count });
  }

  const focusToday = s.focus_sessions.filter((f) => f.started_at.slice(0, 10) === today && f.completed);
  const focusWeek = s.focus_sessions.filter((f) => f.started_at >= new Date(weekStart).toISOString() && f.completed);

  return {
    todayCount: doneToday.length,
    weekCount: doneThisWeek.length,
    monthCount: doneThisMonth.length,
    completionRate,
    overdueCount: overdue.length,
    inboxCount: openTasks.filter((t) => t.status === 'inbox').length,
    byWeekday,
    byCategory,
    byPriority,
    activeProjects,
    last14,
    focusMinutesToday: focusToday.reduce((a, f) => a + (f.completed_minutes ?? 0), 0),
    focusMinutesWeek: focusWeek.reduce((a, f) => a + (f.completed_minutes ?? 0), 0),
  };
}
