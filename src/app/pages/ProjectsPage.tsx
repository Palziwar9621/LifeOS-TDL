// LifeOS — Projects: cards, milestones, linked tasks, editor
import React, { useState } from 'react';
import { Icon, Modal, ProgressBar, EmptyState, useConfirm } from '../../ui/components';
import { dbState, createProject, updateProject, deleteProject, createProjectMilestone, updateProjectMilestone, deleteProjectMilestone } from '../../lib/db';
import { PRIORITY_LABEL, PROJECT_STATUS_LABEL } from '../../lib/types';
import type { Project, ProjectStatus, Priority } from '../../lib/types';
import { fmtDate } from '../../lib/dates';
import { TaskRow } from '../TaskRow';
import { TaskEditor } from '../TaskEditor';
import { useApp } from '../store';

const STATUS_STYLE: Record<ProjectStatus, string> = {
  idea: 'chip', planning: 'chip chip-brand', active: 'chip chip-ok',
  on_hold: 'chip chip-warn', completed: 'chip', archived: 'chip',
};

export function ProjectsPage() {
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [taskEdit, setTaskEdit] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>('active');

  const projects = s.projects
    .filter((p) => statusFilter === 'all' ? true : p.status === statusFilter)
    .sort((a, b) => a.sort_order - b.sort_order);

  const progressOf = (p: Project) => {
    const tasks = s.tasks.filter((t) => t.project_id === p.id && !t.deleted);
    const ms = s.project_milestones.filter((m) => m.project_id === p.id);
    if (tasks.length === 0 && ms.length === 0) return 0;
    const tDone = tasks.filter((t) => t.status === 'completed').length;
    const msDone = ms.filter((m) => m.done).length;
    return Math.round(((tDone + msDone) / (tasks.length + ms.length)) * 100);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Projects</h1>
        <div className="flex items-center gap-2">
          <select className="input !w-auto !py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            {['active', 'planning', 'idea', 'on_hold', 'completed', 'archived', 'all'].map((st) => (
              <option key={st} value={st}>{st === 'all' ? 'All statuses' : PROJECT_STATUS_LABEL[st as ProjectStatus] ?? st}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New project</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon="folder" title="No projects here" hint="Create a project to group related tasks and track progress."
          action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Create your first project</button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => {
            const pct = progressOf(p);
            const ms = s.project_milestones.filter((m) => m.project_id === p.id).sort((a, b) => a.sort_order - b.sort_order);
            const tasks = s.tasks.filter((t) => t.project_id === p.id && !t.deleted);
            const open = openProject === p.id;
            return (
              <section key={p.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
                      <h2 className="truncate text-base font-bold">{p.name}</h2>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className={STATUS_STYLE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</span>
                      <span className="chip">{PRIORITY_LABEL[p.priority]}</span>
                      {p.target_date && <span className="chip">Target {fmtDate(p.target_date)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button className="btn-ghost btn-sm" aria-label="Edit project" onClick={() => setEditing(p)}><Icon name="edit" className="h-4 w-4" /></button>
                    <button className="btn-ghost btn-sm text-rose-500" aria-label="Delete project"
                      onClick={() => confirm('Delete project?', `“${p.name}” and its milestones will be removed. Tasks are kept but unlinked.`, () => void deleteProject(p.id))}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {p.description && <p className="mt-2 line-clamp-2 text-sm muted">{p.description}</p>}
                <div className="mt-3"><ProgressBar value={pct} color={p.color} label="Progress" /></div>

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs font-semibold muted">{tasks.filter((t) => t.status === 'completed').length}/{tasks.length} tasks · {ms.filter((m) => m.done).length}/{ms.length} milestones</p>
                  <button className="text-xs font-bold text-brand-600 dark:text-brand-300" onClick={() => setOpenProject(open ? null : p.id)}>
                    {open ? 'Hide details' : 'Details'}
                  </button>
                </div>

                {open && (
                  <div className="mt-3 space-y-4 border-t border-slate-900/5 dark:border-white/10 pt-3">
                    {/* Milestones */}
                    <div>
                      <p className="label">Milestones</p>
                      <div className="space-y-1">
                        {ms.map((m) => (
                          <div key={m.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" className="checkbox-tap" checked={m.done}
                              onChange={(e) => void updateProjectMilestone(m.id, { done: e.target.checked })}
                              aria-label={`Milestone ${m.title}`} />
                            <span className={`flex-1 ${m.done ? 'line-through muted' : ''}`}>{m.title}</span>
                            {m.due_date && <span className="chip">{fmtDate(m.due_date)}</span>}
                            <button className="btn-ghost btn-sm" aria-label="Delete milestone" onClick={() => void deleteProjectMilestone(m.id)}>
                              <Icon name="x" className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <InlineMilestoneAdd onAdd={(title) => void createProjectMilestone(p.id, title)} />
                    </div>
                    {/* Tasks */}
                    <div>
                      <p className="label">Tasks</p>
                      <div className="space-y-2">
                        {tasks.length === 0 && <p className="text-sm muted">No tasks linked yet.</p>}
                        {tasks.map((t) => <TaskRow key={t.id} task={t} onEdit={setTaskEdit} showProject={false} />)}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <ProjectEditor
          project={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <TaskEditor task={taskEdit} onClose={() => setTaskEdit(null)} />
      {confirmEl}
    </div>
  );
}

function InlineMilestoneAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="mt-2 flex gap-1.5">
      <input className="input !py-1.5 text-sm" placeholder="Add milestone + Enter" value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } }} />
    </div>
  );
}

function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { toast } = useAppToast();
  const s = dbState();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'planning');
  const [priority, setPriority] = useState<Priority>(project?.priority ?? 'medium');
  const [color, setColor] = useState(project?.color ?? '#6366f1');
  const [startDate, setStartDate] = useState(project?.start_date ?? '');
  const [targetDate, setTargetDate] = useState(project?.target_date ?? '');

  const save = async () => {
    if (!name.trim()) { toast('Give the project a name', 'error'); return; }
    const payload = { name: name.trim(), description: description || null, status, priority, color, start_date: startDate || null, target_date: targetDate || null };
    if (project) await updateProject(project.id, payload);
    else await createProject(payload);
    toast(project ? 'Project updated' : 'Project created', 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={project ? 'Edit project' : 'New project'}>
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((k) => <option key={k} value={k}>{PROJECT_STATUS_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Target date</label>
            <input type="date" className="input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
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
          <button className="btn-primary" onClick={() => void save()}>Save project</button>
        </div>
      </div>
    </Modal>
  );
}

function useAppToast() {
  return useApp();
}
