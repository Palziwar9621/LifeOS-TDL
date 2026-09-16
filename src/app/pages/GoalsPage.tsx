// LifeOS — Goals & long-term plans
import React, { useState } from 'react';
import { Icon, Modal, ProgressBar, EmptyState, useConfirm } from '../../ui/components';
import { dbState, createGoal, updateGoal, deleteGoal, createGoalMilestone, updateGoalMilestone, deleteGoalMilestone } from '../../lib/db';
import type { Goal, GoalHorizon } from '../../lib/types';
import { fmtDate } from '../../lib/dates';
import { TaskRow } from '../TaskRow';
import { TaskEditor } from '../TaskEditor';
import { useApp } from '../store';

const HORIZON_LABEL: Record<GoalHorizon, string> = {
  long_term: 'Long-term', yearly: 'Yearly', monthly: 'Monthly', weekly: 'Weekly',
};

export function GoalsPage() {
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [taskEdit, setTaskEdit] = useState<any>(null);
  const [filter, setFilter] = useState<string>('active');

  const goals = s.goals.filter((g) => filter === 'all' ? true : g.status === filter);

  const progressOf = (g: Goal): number => {
    const ms = s.goal_milestones.filter((m) => m.goal_id === g.id);
    const tasks = s.tasks.filter((t) => t.goal_id === g.id && !t.deleted);
    if (ms.length === 0 && tasks.length === 0) return g.progress;
    const done = ms.filter((m) => m.done).length + tasks.filter((t) => t.status === 'completed').length;
    return Math.round((done / (ms.length + tasks.length)) * 100);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Goals</h1>
        <div className="flex items-center gap-2">
          <select className="input !w-auto !py-2" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter goals">
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New goal</button>
        </div>
      </div>

      {goals.length === 0 ? (
        <EmptyState icon="target" title="No goals yet" hint="Set a long-term direction: yearly, monthly, weekly or lifetime."
          action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Create your first goal</button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => {
            const pct = progressOf(g);
            const ms = s.goal_milestones.filter((m) => m.goal_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
            const tasks = s.tasks.filter((t) => t.goal_id === g.id && !t.deleted);
            return (
              <section key={g.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold">{g.title}</h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="chip chip-brand">{HORIZON_LABEL[g.horizon]}</span>
                      {g.deadline && <span className="chip">By {fmtDate(g.deadline)}</span>}
                      {g.status !== 'active' && <span className="chip">{g.status}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button className="btn-ghost btn-sm" aria-label="Edit goal" onClick={() => setEditing(g)}><Icon name="edit" className="h-4 w-4" /></button>
                    <button className="btn-ghost btn-sm text-rose-500" aria-label="Delete goal"
                      onClick={() => confirm('Delete goal?', `“${g.title}” and its milestones will be removed. Tasks are kept but unlinked.`, () => void deleteGoal(g.id))}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {g.description && <p className="mt-2 text-sm muted">{g.description}</p>}
                <div className="mt-3"><ProgressBar value={pct} color={g.color} label="Progress" /></div>

                <div className="mt-3">
                  <p className="label">Milestones</p>
                  <div className="space-y-1">
                    {ms.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="checkbox-tap" checked={m.done}
                          onChange={(e) => void updateGoalMilestone(m.id, { done: e.target.checked })}
                          aria-label={`Milestone ${m.title}`} />
                        <span className={`flex-1 ${m.done ? 'line-through muted' : ''}`}>{m.title}</span>
                        <button className="btn-ghost btn-sm" aria-label="Delete milestone" onClick={() => void deleteGoalMilestone(m.id)}>
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {ms.length === 0 && <p className="text-xs muted">No milestones yet.</p>}
                  </div>
                  <InlineMilestoneAdd onAdd={(t) => void createGoalMilestone(g.id, t)} />
                </div>

                {tasks.length > 0 && (
                  <div className="mt-3 border-t border-slate-900/5 dark:border-white/10 pt-3">
                    <p className="label">Related tasks</p>
                    <div className="space-y-2">
                      {tasks.slice(0, 5).map((t) => <TaskRow key={t.id} task={t} onEdit={setTaskEdit} />)}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editing && <GoalEditor goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <TaskEditor task={taskEdit} onClose={() => setTaskEdit(null)} />
      {confirmEl}
    </div>
  );
}

function InlineMilestoneAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <input className="input mt-2 !py-1.5 text-sm" placeholder="Add milestone + Enter" value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } }} />
  );
}

function GoalEditor({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { toast } = useApp();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [horizon, setHorizon] = useState<GoalHorizon>(goal?.horizon ?? 'long_term');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [color, setColor] = useState(goal?.color ?? '#6366f1');

  const save = async () => {
    if (!title.trim()) { toast('Give the goal a title', 'error'); return; }
    const payload = { title: title.trim(), description: description || null, horizon, deadline: deadline || null, color };
    if (goal) await updateGoal(goal.id, payload);
    else await createGoal(payload);
    toast(goal ? 'Goal updated' : 'Goal created', 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={goal ? 'Edit goal' : 'New goal'}>
      <div className="space-y-3">
        <div>
          <label className="label">Goal</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Improve programming skills" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Horizon</label>
            <select className="input" value={horizon} onChange={(e) => setHorizon(e.target.value as GoalHorizon)}>
              {Object.entries(HORIZON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Target date</label>
            <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-1.5">
            {['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b'].map((c) => (
              <button key={c} className={`h-8 w-8 rounded-full ring-2 ${color === c ? 'ring-slate-900 dark:ring-white' : 'ring-transparent'}`}
                style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>Save goal</button>
        </div>
      </div>
    </Modal>
  );
}
