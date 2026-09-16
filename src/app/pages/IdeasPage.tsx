// LifeOS — Ideas & Future (someday/maybe)
import React, { useState } from 'react';
import { Icon, Modal, EmptyState, useConfirm } from '../../ui/components';
import { dbState, createIdea, updateIdea, deleteIdea, convertIdeaToProject } from '../../lib/db';
import { IdeaCaptureModal } from '../IdeaCapture';
import { IDEA_STATUS_LABEL, PRIORITY_LABEL, EFFORT_LABEL } from '../../lib/types';
import type { Idea, IdeaStatus, Priority } from '../../lib/types';
import { fmtDate } from '../../lib/dates';
import { useApp } from '../store';

const STATUS_STYLE: Record<IdeaStatus, string> = {
  idea: 'chip', someday: 'chip', planned: 'chip chip-brand', ready_to_start: 'chip chip-ok',
  active: 'chip chip-warn', completed: 'chip chip-ok', abandoned: 'chip',
};

export function IdeasPage() {
  const s = dbState();
  const { toast } = useApp();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<Idea | 'new' | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const ideas = s.ideas.filter((i) =>
    (statusFilter ? i.status === statusFilter : !['completed', 'abandoned', 'active'].includes(i.status)) &&
    (!search || i.title.toLowerCase().includes(search.toLowerCase()) || (i.description ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm muted">Parking lot for someday/maybe — out of today's way, never forgotten.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setCapturing(true)} aria-label="Instant idea capture with photo or voice">
            <Icon name="bulb" className="h-4 w-4" /> Capture 💡
          </button>
          <button className="btn-secondary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New idea</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input !w-48 !py-2" placeholder="Search ideas…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input !w-auto !py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">Open ideas</option>
          {(Object.keys(IDEA_STATUS_LABEL) as IdeaStatus[]).map((k) => <option key={k} value={k}>{IDEA_STATUS_LABEL[k]}</option>)}
          <option value="all">All</option>
        </select>
      </div>

      {ideas.length === 0 ? (
        <EmptyState icon="bulb" title="No ideas captured" hint="That thing you keep meaning to do later? Put it here."
          action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Capture an idea</button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {ideas.map((i) => (
            <section key={i.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{i.title}</h2>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={STATUS_STYLE[i.status]}>{IDEA_STATUS_LABEL[i.status]}</span>
                    <span className="chip">{PRIORITY_LABEL[i.priority]}</span>
                    {i.effort && <span className="chip">{EFFORT_LABEL[i.effort]}</span>}
                    {i.possible_start && <span className="chip">Maybe {fmtDate(i.possible_start)}</span>}
                    {i.converted_project_id && <span className="chip chip-ok">✓ Project created</span>}
                  </div>
                </div>
                <button className="btn-ghost btn-sm text-rose-500 shrink-0" aria-label="Delete idea"
                  onClick={() => confirm('Delete idea?', `“${i.title}” will be removed.`, () => void deleteIdea(i.id))}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
              {i.photo_data && (
                <img src={i.photo_data} alt={`Photo for ${i.title}`} className="mt-2 w-full max-h-44 object-cover rounded-lg border border-slate-900/10 dark:border-white/10" loading="lazy" />
              )}
              {i.voice_data && (
                <div className="mt-2 flex items-center gap-2">
                  <audio controls preload="none" src={i.voice_data} className="w-full h-9" />
                  {i.voice_duration_secs ? <span className="chip shrink-0">🎙 {Math.floor(i.voice_duration_secs / 60)}:{String(i.voice_duration_secs % 60).padStart(2, '0')}</span> : null}
                </div>
              )}
              {i.description && <p className="mt-2 line-clamp-2 text-sm muted">{i.description}</p>}
              {i.why && <p className="mt-1 text-xs muted"><b>Why:</b> {i.why}</p>}
              <div className="mt-3 flex items-center gap-2">
                <button className="btn-secondary btn-sm" onClick={() => setEditing(i)}><Icon name="edit" className="h-3.5 w-3.5" /> Edit</button>
                {!i.converted_project_id && (
                  <button className="btn-primary btn-sm"
                    onClick={async () => {
                      await convertIdeaToProject(i.id);
                      toast('Idea converted to an active project 🎉', 'success');
                    }}>
                    <Icon name="folder" className="h-3.5 w-3.5" /> Make it a project
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <IdeaCaptureModal open={capturing} onClose={() => setCapturing(false)} onCaptured={() => setStatusFilter('')} />
      {editing && <IdeaEditor idea={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </div>
  );
}

function IdeaEditor({ idea, onClose }: { idea: Idea | null; onClose: () => void }) {
  const { toast } = useApp();
  const [title, setTitle] = useState(idea?.title ?? '');
  const [description, setDescription] = useState(idea?.description ?? '');
  const [why, setWhy] = useState(idea?.why ?? '');
  const [notes, setNotes] = useState(idea?.notes ?? '');
  const [links, setLinks] = useState(idea?.links ?? '');
  const [status, setStatus] = useState<IdeaStatus>(idea?.status ?? 'idea');
  const [priority, setPriority] = useState<Priority>(idea?.priority ?? 'medium');
  const [effort, setEffort] = useState(idea?.effort ?? '');
  const [possibleStart, setPossibleStart] = useState(idea?.possible_start ?? '');
  const [targetDate, setTargetDate] = useState(idea?.target_date ?? '');

  const save = async () => {
    if (!title.trim()) { toast('Give the idea a title', 'error'); return; }
    const payload = {
      title: title.trim(), description: description || null, why: why || null,
      notes: notes || null, links: links || null, status, priority,
      effort: (effort || null) as any,
      possible_start: possibleStart || null, target_date: targetDate || null,
    };
    if (idea) await updateIdea(idea.id, payload);
    else await createIdea(payload);
    toast(idea ? 'Idea updated' : 'Idea captured', 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={idea ? 'Edit idea' : 'New idea'} wide>
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Build AI Attendance System" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label">Why I want to do it</label>
          <textarea className="input min-h-14" value={why} onChange={(e) => setWhy(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as IdeaStatus)}>
              {(Object.keys(IDEA_STATUS_LABEL) as IdeaStatus[]).map((k) => <option key={k} value={k}>{IDEA_STATUS_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Estimated effort</label>
            <select className="input" value={effort} onChange={(e) => setEffort(e.target.value)}>
              <option value="">Unknown</option>
              {Object.entries(EFFORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Possible start</label>
            <input type="date" className="input" value={possibleStart} onChange={(e) => setPossibleStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Target date</label>
            <input type="date" className="input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Links</label>
          <input className="input" value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>Save idea</button>
        </div>
      </div>
    </Modal>
  );
}
