// LifeOS — Focus Mode (Pomodoro & custom timer)
import React, { useEffect, useRef, useState } from 'react';
import { Icon, EmptyState } from '../../ui/components';
import { dbState, createFocusSession, completeTask } from '../../lib/db';
import { useApp } from '../store';

export function FocusPage() {
  const { toast } = useApp();
  const s = dbState();
  const openTasks = s.tasks.filter((t) => !t.deleted && !t.archived && t.status !== 'completed' && t.status !== 'cancelled');
  const [taskId, setTaskId] = useState('');
  const [mode, setMode] = useState<'pomodoro' | 'custom'>('pomodoro');
  const [focusMin, setFocusMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const [phase, setPhase] = useState<'idle' | 'focus' | 'break' | 'paused'>('idle');
  const [remaining, setRemaining] = useState(25 * 60);
  const [sessionFocusMin, setSessionFocusMin] = useState(25);
  const endRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };

  useEffect(() => () => clearTick(), []);

  const start = () => {
    const mins = focusMin;
    setSessionFocusMin(mins);
    setPhase('focus');
    setRemaining(mins * 60);
    endRef.current = Date.now() + mins * 60000;
    clearTick();
    tickRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearTick();
        void finish(true);
      }
    }, 500);
  };

  const pause = () => {
    clearTick();
    setPhase((p) => (p === 'focus' ? 'paused' : 'focus'));
    if (phase === 'paused') {
      endRef.current = Date.now() + remaining * 1000;
      tickRef.current = setInterval(() => {
        const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
        setRemaining(left);
        if (left <= 0) { clearTick(); void finish(true); }
      }, 500);
    }
  };

  const stop = async (completedFlag: boolean) => {
    clearTick();
    const elapsedMin = Math.round((sessionFocusMin * 60 - remaining) / 60);
    if (elapsedMin >= 1) {
      await createFocusSession({
        task_id: taskId || null, mode,
        duration_minutes: sessionFocusMin,
        completed_minutes: elapsedMin,
        completed: completedFlag,
      });
    }
    setPhase('idle');
    setRemaining(focusMin * 60);
    if (completedFlag) toast('Focus session complete 🎉 Take a break.', 'success');
  };

  const finish = async (completedFlag: boolean) => {
    clearTick();
    await createFocusSession({
      task_id: taskId || null, mode,
      duration_minutes: sessionFocusMin,
      completed_minutes: sessionFocusMin,
      completed: completedFlag,
    });
    setPhase('break');
    setRemaining(breakMin * 60);
    if (Notification?.permission === 'granted') {
      try { new Notification('Focus done!', { body: 'Time for a short break.' }); } catch { /* noop */ }
    }
  };

  const beginBreak = () => {
    setPhase('focus'); // reuse timer with break length
    endRef.current = Date.now() + breakMin * 60000;
    tickRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearTick();
        setPhase('idle');
        setRemaining(focusMin * 60);
        toast('Break over — ready for another round?', 'info');
      }
    }, 500);
  };

  const total = (phase === 'break' ? breakMin : sessionFocusMin) * 60;
  const pct = total > 0 ? 100 - (remaining / total) * 100 : 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const task = s.tasks.find((t) => t.id === taskId);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Focus</h1>
        <p className="text-sm muted">One task, a timer, nothing else.</p>
      </div>

      <div className="mx-auto max-w-lg">
        <section className="card p-6 text-center">
          {/* Timer ring */}
          <div className="relative mx-auto h-56 w-56">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle cx="60" cy="60" r="54" fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-700" />
              <circle cx="60" cy="60" r="54" fill="none" strokeWidth="8" strokeLinecap="round"
                className="stroke-brand-600 transition-all duration-500"
                strokeDasharray={2 * Math.PI * 54}
                strokeDashoffset={2 * Math.PI * 54 * (1 - pct / 100)} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {phase === 'break' && <span className="text-xs font-bold uppercase tracking-widest text-emerald-500">Break</span>}
              {phase === 'paused' && <span className="text-xs font-bold uppercase tracking-widest text-amber-500">Paused</span>}
              <span className="text-5xl font-extrabold tabular-nums tracking-tight">{mm}:{ss}</span>
              {task && <span className="mt-1 max-w-40 truncate text-sm muted">{task.title}</span>}
            </div>
          </div>

          {phase === 'idle' ? (
            <div className="mt-6 space-y-4">
              <div>
                <label className="label">What are you focusing on?</label>
                <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                  <option value="">Just a general session</option>
                  {openTasks.slice(0, 200).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="label">Mode</label>
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                    <option value="pomodoro">Pomodoro</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="label">Focus (min)</label>
                  <input type="number" min={1} max={180} className="input" value={focusMin}
                    onChange={(e) => setFocusMin(Math.max(1, parseInt(e.target.value, 10) || 25))} />
                </div>
                <div>
                  <label className="label">Break (min)</label>
                  <input type="number" min={1} max={60} className="input" value={breakMin}
                    onChange={(e) => setBreakMin(Math.max(1, parseInt(e.target.value, 10) || 5))} />
                </div>
              </div>
              <button className="btn-primary w-full !py-3 text-base" onClick={start}>
                <Icon name="play" className="h-5 w-5" /> Start focus
              </button>
            </div>
          ) : (
            <div className="mt-6 flex justify-center gap-2">
              {phase === 'paused' ? (
                <button className="btn-primary" onClick={pause}><Icon name="play" className="h-4 w-4" /> Resume</button>
              ) : (
                <button className="btn-secondary" onClick={pause}><Icon name="pause" className="h-4 w-4" /> Pause</button>
              )}
              {phase === 'break' ? (
                <button className="btn-primary" onClick={beginBreak}>Skip break</button>
              ) : (
                <button className="btn-primary" onClick={() => void stop(false)}>Finish</button>
              )}
              <button className="btn-danger" onClick={() => void stop(false)}>Stop</button>
            </div>
          )}

          {task && phase === 'idle' && (
            <button className="btn-secondary btn-sm mt-3"
              onClick={async () => { await completeTask(task.id); toast('Task completed 🎉', 'success'); }}>
              ✓ Mark task complete
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
