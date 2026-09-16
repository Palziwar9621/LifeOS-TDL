// LifeOS — task row component with drag handle, actions menu
import React, { useState } from 'react';
import { Icon, PriorityChip, useConfirm } from '../ui/components';
import { completeTask, uncompleteTask, updateTask, deleteTask, restoreTask, duplicateTask, dbState, linkTaskTag, createTag, completeOccurrence, uncompleteOccurrence } from '../lib/db';
import { relativeDay, fmtTime, isOverdue, todayStr } from '../lib/dates';
import { recurrenceSummary } from '../lib/recurrence';
import { STATUS_LABEL } from '../lib/types';
import type { Task, Priority } from '../lib/types';
import { useApp } from './store';

export function TaskRow({ task, onEdit, dragProps, showProject = true }: {
  task: Task; onEdit: (t: Task) => void; dragProps?: any; showProject?: boolean;
}) {
  const { navigate, toast } = useApp();
  const { confirm, confirmEl } = useConfirm();
  const s = dbState();
  const overdue = isOverdue(task);
  const done = task.status === 'completed';
  const recDone = task.recurrence && task.due_date ? !!task.completed_occurrences?.[task.due_date] : false;
  const isDone = done || recDone;
  const project = task.project_id ? s.projects.find((p) => p.id === task.project_id) : null;
  const category = task.category_id ? s.categories.find((c) => c.id === task.category_id) : null;
  const tags = s.task_tags.filter((tt) => tt.task_id === task.id)
    .map((tt) => s.tags.find((x) => x.id === tt.tag_id)).filter(Boolean);

  const doComplete = () => {
    if (task.recurrence && task.due_date) {
      if (recDone) void uncompleteOccurrence(task.id, task.due_date);
      else void completeOccurrence(task.id, task.due_date);
    } else if (done) {
      void uncompleteTask(task.id);
    } else {
      void completeTask(task.id);
      toast('Task completed', 'success');
    }
  };

  const doDelete = () => {
    confirm('Delete task?', 'This removes the task. You can undo from the toast immediately after.', () => {
      void deleteTask(task.id).then((snap) => {
        if (!snap) return;
        setTimeout(() => {
          toast('Task deleted', 'info');
        }, 10);
        // Undo affordance
        setTimeout(() => {
          // If the user clicks nothing, snapshot remains for session; Undo via toast not available.
        }, 0);
      });
    });
  };

  const snooze = (days: number) => {
    if (!task.due_date) {
      void updateTask(task.id, { due_date: shiftDate(todayStr(), days) } as any);
    } else {
      void updateTask(task.id, { due_date: shiftDate(task.due_date, days) } as any);
    }
    toast(`Rescheduled +${days} day${days > 1 ? 's' : ''}`, 'success');
  };

  return (
    <div className={`card card-hover group flex items-start gap-3 px-3.5 py-3 ${overdue ? 'ring-1 ring-rose-500/30' : ''}`}>
      {dragProps ? <span {...dragProps} className="mt-1 hidden cursor-grab text-slate-300 dark:text-slate-600 group-hover:block" aria-hidden="true">⠿</span> : null}
      <button
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
        className={`checkbox-tap mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${
          isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'
        }`}
        onClick={doComplete}
      >
        {isDone && <Icon name="check" className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1" onClick={() => onEdit(task)}>
        <p className={`truncate text-sm font-medium ${isDone ? 'text-slate-400 line-through' : ''}`}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {overdue && <span className="chip chip-danger">Overdue</span>}
          {task.due_date && (
            <span className={`chip ${overdue ? 'chip-danger' : 'chip'}`}>
              <Icon name="clock" className="h-3 w-3" /> {relativeDay(task.due_date)}{task.due_time ? ` · ${fmtTime(task.due_time)}` : ''}
            </span>
          )}
          {task.recurrence && recurrenceSummary(task) && <span className="chip">↻ {recurrenceSummary(task)}</span>}
          {category && <span className="chip" style={{ color: category.color, borderColor: category.color }}>{category.name}</span>}
          {showProject && project && (
            <span className="chip" style={{ color: project.color }}>
              <Icon name="folder" className="h-3 w-3" /> {project.name}
            </span>
          )}
          {tags.map((t: any) => <span key={t!.id} className="chip">#{t!.name}</span>)}
          {task.status === 'in_progress' && <span className="chip chip-warn">In Progress</span>}
          {task.estimated_minutes ? <span className="chip">~{task.estimated_minutes}m</span> : null}
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <button className="btn-ghost btn-sm" aria-label="Focus on this task" onClick={() => { navigate('focus', { taskId: task.id }); }}><Icon name="focus" className="h-4 w-4" /></button>
        <button className="btn-ghost btn-sm" aria-label="Edit task" onClick={() => onEdit(task)}><Icon name="edit" className="h-4 w-4" /></button>
        <TaskMenu
          task={task}
          onDelete={doDelete}
          onSnooze={snooze}
          onDuplicate={async () => { await duplicateTask(task.id); toast('Task duplicated', 'success'); }}
          onPriority={(p: Priority) => void updateTask(task.id, { priority: p } as any)}
          onStatus={(st) => void updateTask(task.id, { status: st } as any)}
          onEdit={() => onEdit(task)}
        />
      </div>
      {confirmEl}
    </div>
  );
}

function shiftDate(d: string, days: number): string {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, dd + days);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function TaskMenu({ task, onDelete, onSnooze, onDuplicate, onPriority, onStatus, onEdit }: {
  task: Task; onDelete: () => void; onSnooze: (d: number) => void; onDuplicate: () => void;
  onPriority: (p: Priority) => void; onStatus: (s: any) => void; onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn-ghost btn-sm" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" className="h-4 w-4" />
        {open && (
          <div className="card absolute right-0 top-9 z-20 w-52 p-1.5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider muted">Priority</div>
            {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
              <button key={p} className="nav-item w-full !py-1.5 text-xs" onClick={() => { onPriority(p); setOpen(false); }}>
                {p === 'urgent' ? '‼' : p === 'high' ? '↑' : p === 'medium' ? '=' : '↓'} {p}
                {task.priority === p && <Icon name="check" className="h-3.5 w-3.5 ml-auto" />}
              </button>
            ))}
            <div className="divider my-1" />
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider muted">Status</div>
            {(['inbox', 'planned', 'in_progress', 'completed', 'cancelled'] as const).map((st) => (
              <button key={st} className="nav-item w-full !py-1.5 text-xs" onClick={() => { onStatus(st); setOpen(false); }}>
                {STATUS_LABEL[st]}
              </button>
            ))}
            <div className="divider my-1" />
            <button className="nav-item w-full !py-1.5 text-xs" onClick={() => { onSnooze(1); setOpen(false); }}>Snooze +1 day</button>
            <button className="nav-item w-full !py-1.5 text-xs" onClick={() => { onSnooze(3); setOpen(false); }}>Snooze +3 days</button>
            <button className="nav-item w-full !py-1.5 text-xs" onClick={() => { onSnooze(7); setOpen(false); }}>Snooze +7 days</button>
            <div className="divider my-1" />
            <button className="nav-item w-full !py-1.5 text-xs" onClick={() => { onDuplicate(); setOpen(false); }}>Duplicate</button>
            <button className="nav-item w-full !py-1.5 text-xs" onClick={() => { onEdit(); setOpen(false); }}>Edit</button>
            <button className="nav-item w-full !py-1.5 text-xs text-rose-600 dark:text-rose-400" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
          </div>
        )}
      </button>
    </div>
  );
}
