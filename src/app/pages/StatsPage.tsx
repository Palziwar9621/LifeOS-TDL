// LifeOS — Insights hub: Statistics + Daily/Weekly Review in one place
import React, { useMemo, useState } from 'react';
import { ProgressBar, EmptyState } from '../../ui/components';
import { computeStats } from '../../lib/stats';
import { weekdayShort } from '../../lib/dates';
import { useApp } from '../store';
import { ReviewPanel } from './ReviewPage';

export function StatsPage() {
  const { version } = useApp();
  const stats = useMemo(() => computeStats(), [version]);
  const [tab, setTab] = useState<'stats' | 'review'>('stats');

  const maxDay = Math.max(1, ...stats.byWeekday);
  const max14 = Math.max(1, ...stats.last14.map((d) => d.count));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Insights</h1>
        <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
          {(['stats', 'review'] as const).map((t) => (
            <button key={t} className={`px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
              onClick={() => setTab(t)}>
              {t === 'stats' ? '📊 Statistics' : '🕐 Review'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'review' ? <ReviewPanel /> : <Statistics stats={stats} maxDay={maxDay} max14={max14} />}
    </div>
  );
}

function Statistics({ stats, maxDay, max14 }: { stats: ReturnType<typeof computeStats>; maxDay: number; max14: number }) {
  return (
    <div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Completed today" value={stats.todayCount} icon="check" />
        <StatCard label="This week" value={stats.weekCount} icon="calendar" />
        <StatCard label="This month" value={stats.monthCount} icon="chart" />
        <StatCard label="Completion rate" value={`${stats.completionRate}%`} icon="target" />
      </div>

      {/* Routine (Productivity tab) performance */}
      <section className="card mt-4 p-5">
        <h2 className="section-title mb-1">Daily routine</h2>
        <p className="mb-4 text-xs muted">How consistent you've been with your Productivity-tab routines over the last 4 weeks.</p>
        {stats.routine.totalTasks === 0 ? (
          <p className="text-sm muted">No routine tasks yet — add some in the Productivity tab to see your consistency here.</p>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <RoutineStat value={`${stats.routine.todayPct}%`} label="Today's routine" />
              <RoutineStat value={stats.routine.streak > 0 ? `🔥 ${stats.routine.streak}d` : '—'} label="All-done streak" />
              <RoutineStat value={`${stats.routine.totalTasks}`} label="Active routines" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold muted">Completion rate by weekday</p>
                <div className="space-y-2">
                  {weekdayShort(1).map((name, i) => {
                    const wd = (i + 1) % 7;
                    const pct = stats.routine.weekdayPct[wd];
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <span className="w-10 text-xs font-semibold muted">{name}</span>
                        <div className="progress-track flex-1"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                        <span className="w-10 text-right text-xs font-bold">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold muted">Routine ticks — last 14 days</p>
                <div className="flex h-28 items-end gap-1.5">
                  {(() => {
                    const max = Math.max(1, ...stats.routine.last14.map((d) => d.count));
                    return stats.routine.last14.map((d) => (
                      <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.count} ticks`}>
                        <div className="w-full rounded-t-md bg-emerald-500/80 transition-all" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 4 : 2, opacity: d.count ? 1 : 0.25 }} />
                        <span className="text-[9px] muted">{d.date.slice(8)}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="section-title mb-4">Last 14 days</h2>
          <div className="flex h-36 items-end gap-1.5">
            {stats.last14.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.count}`}>
                <div className="w-full rounded-t-md bg-brand-500/80 transition-all" style={{ height: `${(d.count / max14) * 100}%`, minHeight: d.count ? 4 : 2, opacity: d.count ? 1 : 0.25 }} />
                <span className="text-[9px] muted">{d.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-4">Most productive days</h2>
          <div className="space-y-2">
            {weekdayShort(1).map((name, i) => (
              <div key={name} className="flex items-center gap-3">
                <span className="w-10 text-xs font-semibold muted">{name}</span>
                <div className="progress-track flex-1"><div className="progress-fill" style={{ width: `${(stats.byWeekday[(i + 1) % 7] / maxDay) * 100}%` }} /></div>
                <span className="w-8 text-right text-xs font-bold">{stats.byWeekday[(i + 1) % 7]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-4">Open tasks by priority</h2>
          <div className="space-y-2.5">
            {stats.byPriority.map((p) => (
              <div key={p.label} className="flex items-center gap-3">
                <span className="w-20 text-sm font-semibold">{p.icon} {p.label}</span>
                <div className="progress-track flex-1"><div className="progress-fill" style={{ width: `${(p.count / Math.max(1, ...stats.byPriority.map((x) => x.count))) * 100}%`, background: p.color }} /></div>
                <span className="w-8 text-right text-xs font-bold">{p.count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-4">Completions by category</h2>
          {stats.byCategory.length === 0 ? (
            <p className="text-sm muted">Complete some tasks to see this breakdown.</p>
          ) : (
            <div className="space-y-2.5">
              {stats.byCategory.map((c) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="w-24 truncate text-sm font-semibold">{c.name}</span>
                  <div className="progress-track flex-1"><div className="progress-fill" style={{ width: `${(c.count / stats.byCategory[0].count) * 100}%`, background: c.color }} /></div>
                  <span className="w-8 text-right text-xs font-bold">{c.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-4">Project progress</h2>
          {stats.activeProjects.length === 0 ? (
            <p className="text-sm muted">No active projects.</p>
          ) : (
            <div className="space-y-3">
              {stats.activeProjects.map((p) => <ProgressBar key={p.id} value={p.progress} color={p.color} label={p.name} />)}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-4">Focus time</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4 text-center">
              <p className="text-2xl font-extrabold">{stats.focusMinutesToday}</p>
              <p className="text-xs muted">min today</p>
            </div>
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4 text-center">
              <p className="text-2xl font-extrabold">{stats.focusMinutesWeek}</p>
              <p className="text-xs muted">min this week</p>
            </div>
          </div>
          <p className="mt-3 text-xs muted">Open tasks: {stats.inboxCount} in inbox · {stats.overdueCount} overdue</p>
        </section>
      </div>
    </div>
  );
}

function RoutineStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4 text-center">
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs muted">{label}</p>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300">
        <Iconish name={icon} />
      </span>
      <div>
        <p className="text-2xl font-extrabold tracking-tight">{value}</p>
        <p className="text-xs muted">{label}</p>
      </div>
    </div>
  );
}

function Iconish({ name }: { name: string }) {
  // avoid circular import weight; simple glyphs
  const glyphs: Record<string, string> = { check: '✓', calendar: '📅', chart: '📊', target: '🎯' };
  return <span className="text-lg">{glyphs[name] ?? '•'}</span>;
}
